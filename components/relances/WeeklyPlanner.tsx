"use client";

import { useMemo, useState } from "react";
import { Calendar, dateFnsLocalizer, type View } from "react-big-calendar";
import withDragAndDrop, { type EventInteractionArgs, type DragFromOutsideItemArgs } from "react-big-calendar/lib/addons/dragAndDrop";
import { format } from "date-fns/format";
import { parse } from "date-fns/parse";
import { startOfWeek } from "date-fns/startOfWeek";
import { getDay } from "date-fns/getDay";
import { fr } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";
import { createClient } from "@/lib/supabase/client";
import { generateWeeklyPlan, mondayOf } from "@/lib/planning";
import { getPhoneFollowUps } from "@/lib/followups";
import { computeTargetingScore } from "@/lib/scoring";
import { isProspect } from "@/lib/accounts";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { Account, AccountAction, AccountForecast, PlanningEvent, PlanningEventType } from "@/types/database";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Wand2, Trash2, Loader2, Phone, FileText, MapPin, Compass, X, Target, CalendarClock } from "lucide-react";

const locales = { fr };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

const MONTH_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

const TYPE_META: Record<PlanningEventType, { label: string; color: string; icon: typeof MapPin }> = {
  visite: { label: "Visite", color: "#4f46e5", icon: MapPin },
  visite_prospect: { label: "Prospection", color: "#d97706", icon: Compass },
  appel: { label: "Appels", color: "#0ea5e9", icon: Phone },
  admin: { label: "Admin", color: "#64748b", icon: FileText },
};

interface CalEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: PlanningEvent;
}

const DnDCalendar = withDragAndDrop<CalEvent>(Calendar);

function toCalEvent(e: PlanningEvent): CalEvent {
  return { id: e.id, title: e.title, start: new Date(e.start_at), end: new Date(e.end_at), resource: e };
}

export function WeeklyPlanner({
  initialEvents,
  accounts,
  forecasts,
  actions,
}: {
  initialEvents: PlanningEvent[];
  accounts: Account[];
  forecasts: AccountForecast[];
  actions: AccountAction[];
}) {
  const [events, setEvents] = useState<PlanningEvent[]>(initialEvents);
  const [date, setDate] = useState(() => mondayOf(new Date()));
  const [view] = useState<View>("week");
  const [generating, setGenerating] = useState(false);
  const [dragCandidate, setDragCandidate] = useState<{ account_id: string; type: PlanningEventType; title: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const calEvents = useMemo(() => events.map(toCalEvent), [events]);

  const weekEnd = useMemo(() => {
    const d = new Date(date);
    d.setDate(d.getDate() + 6);
    return d;
  }, [date]);

  // Un compte n'est retiré du pool que s'il a déjà une visite dans le même
  // mois calendaire que la semaine affichée — sinon le pool se vide
  // définitivement après 2-3 semaines de génération.
  const scheduledAccountIds = useMemo(() => {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return new Set(
      events
        .filter((e) => e.account_id && new Date(e.start_at) >= monthStart && new Date(e.start_at) < monthEnd)
        .map((e) => e.account_id as string)
    );
  }, [events, date]);

  // ── Panneau latéral : candidats non encore planifiés ────────────────────
  const clientCandidates = useMemo(() => {
    const monthKey = (y: number, m: number) => `${y}-${m}`;
    const thisMonthKey = monthKey(date.getFullYear(), date.getMonth() + 1);
    const nextMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    const nextMonthKey = monthKey(nextMonthDate.getFullYear(), nextMonthDate.getMonth() + 1);
    const bestByAccount = new Map<string, AccountForecast>();
    for (const f of forecasts) {
      if (f.kind !== "prevision") continue;
      const key = monthKey(f.year, f.month);
      if (key !== thisMonthKey && key !== nextMonthKey) continue;
      if ((f.ca_prevu ?? 0) <= 0 && (f.boites_prevues ?? 0) <= 0) continue;
      const cur = bestByAccount.get(f.account_id);
      if (!cur || (f.ca_prevu ?? 0) > (cur.ca_prevu ?? 0)) bestByAccount.set(f.account_id, f);
    }
    return Array.from(bestByAccount.entries())
      .map(([accountId, forecast]) => ({ account: accountById.get(accountId), forecast }))
      .filter((c): c is { account: Account; forecast: AccountForecast } => !!c.account && !scheduledAccountIds.has(c.account.id))
      .sort((a, b) => (b.forecast.ca_prevu ?? 0) - (a.forecast.ca_prevu ?? 0));
  }, [forecasts, accountById, scheduledAccountIds, date]);

  const prospectCandidates = useMemo(
    () =>
      accounts
        .filter((a) => isProspect(a) && !scheduledAccountIds.has(a.id))
        .sort((a, b) => computeTargetingScore(b).total - computeTargetingScore(a).total)
        .slice(0, 40),
    [accounts, scheduledAccountIds]
  );

  const callCandidates = useMemo(
    () => getPhoneFollowUps(accounts.filter((a) => !scheduledAccountIds.has(a.id)), actions).slice(0, 40),
    [accounts, actions, scheduledAccountIds]
  );

  const filteredClients = clientCandidates.filter((c) => c.account.name.toLowerCase().includes(filter.toLowerCase()));
  const filteredProspects = prospectCandidates.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()));
  const filteredCalls = callCandidates.filter((f) => f.account.name.toLowerCase().includes(filter.toLowerCase()));

  // ── Fiche détaillée (clic sur un rendez-vous) ───────────────────────────
  const selectedEvent = selectedId ? events.find((e) => e.id === selectedId) ?? null : null;
  const selectedAccount = selectedEvent?.account_id ? accountById.get(selectedEvent.account_id) ?? null : null;
  const selectedForecast = useMemo(() => {
    if (!selectedAccount) return null;
    const relevant = forecasts.filter((f) => f.kind === "prevision" && f.account_id === selectedAccount.id);
    if (relevant.length === 0) return null;
    return relevant.sort((a, b) => (b.ca_prevu ?? 0) - (a.ca_prevu ?? 0))[0];
  }, [forecasts, selectedAccount]);

  // ── Persistance ──────────────────────────────────────────────────────────
  async function persistUpdate(id: string, patch: Partial<Pick<PlanningEvent, "start_at" | "end_at">>) {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch, source: "manuel" } : e)));
    const supabase = createClient();
    await supabase.from("planning_events").update({ ...patch, source: "manuel" as const }).eq("id", id);
  }

  async function deleteEvent(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    const supabase = createClient();
    await supabase.from("planning_events").delete().eq("id", id);
  }

  async function createEvent(
    accountId: string | null,
    type: PlanningEventType,
    title: string,
    note: string | null,
    start: Date,
    end: Date
  ) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("planning_events")
      .insert({
        account_id: accountId,
        type,
        title,
        note,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        source: "manuel" as const,
      })
      .select()
      .single();
    if (!error && data) setEvents((prev) => [...prev, data as PlanningEvent]);
  }

  async function generate() {
    setGenerating(true);
    const supabase = createClient();

    // Idempotent : un second clic ne doit pas doubler les créneaux admin/
    // appels déjà générés. On supprime d'abord les lignes 'auto' de la
    // semaine affichée avant de réinsérer le nouveau planning.
    const weekEndExclusive = new Date(date);
    weekEndExclusive.setDate(weekEndExclusive.getDate() + 5);
    const staleIds = events
      .filter((e) => e.source === "auto" && new Date(e.start_at) >= date && new Date(e.start_at) < weekEndExclusive)
      .map((e) => e.id);
    if (staleIds.length > 0) {
      await supabase.from("planning_events").delete().in("id", staleIds);
    }
    const remainingEvents = events.filter((e) => !staleIds.includes(e.id));

    const draft = generateWeeklyPlan(
      date,
      accounts,
      forecasts,
      actions,
      remainingEvents.map((e) => ({ account_id: e.account_id, start_at: e.start_at }))
    );
    const { data, error } = await supabase
      .from("planning_events")
      .insert(
        draft.map((d) => ({
          account_id: d.account_id,
          type: d.type,
          title: d.title,
          note: d.note,
          start_at: d.start_at.toISOString(),
          end_at: d.end_at.toISOString(),
          source: "auto" as const,
        }))
      )
      .select();
    setGenerating(false);
    if (!error && data) {
      setEvents((prev) => [...prev.filter((e) => !staleIds.includes(e.id)), ...(data as PlanningEvent[])]);
    }
  }

  return (
    <div className="flex h-[calc(100vh-140px)] gap-4 px-8 py-6">
      {/* ── Panneau latéral : comptes à planifier ─────────────────────── */}
      <div className="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-surface">
        <div className="border-b border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">À planifier</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Glissez un compte dans le calendrier</p>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer..."
            className="mt-2 w-full rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-primary"
          />
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          <SidebarSection
            title="Visites clients"
            color={TYPE_META.visite.color}
            items={filteredClients.map((c) => ({
              key: c.account.id,
              label: c.account.name,
              sub: formatEUR(c.forecast.ca_prevu),
              account_id: c.account.id,
              type: "visite" as const,
            }))}
            onDragStart={setDragCandidate}
          />
          <SidebarSection
            title="Prospects"
            color={TYPE_META.visite_prospect.color}
            items={filteredProspects.map((a) => ({
              key: a.id,
              label: a.name,
              sub: `Score ${computeTargetingScore(a).total}/100`,
              account_id: a.id,
              type: "visite_prospect" as const,
            }))}
            onDragStart={setDragCandidate}
          />
          <SidebarSection
            title="À appeler"
            color={TYPE_META.appel.color}
            items={filteredCalls.map((f) => ({
              key: f.account.id,
              label: f.account.name,
              sub: f.reason,
              account_id: f.account.id,
              type: "appel" as const,
            }))}
            onDragStart={setDragCandidate}
          />
        </div>
      </div>

      {/* ── Calendrier semaine ───────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col rounded-xl border border-border bg-surface p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setDate((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}
              className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-surface-muted"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setDate((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}
              className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-surface-muted"
            >
              <ChevronRight size={16} />
            </button>
            <button onClick={() => setDate(mondayOf(new Date()))} className="ml-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-muted">
              Aujourd&apos;hui
            </button>
            <span className="ml-3 text-sm font-semibold text-foreground">
              {date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} → {weekEnd.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
            </span>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            Générer la semaine
          </button>
        </div>

        <div className="planner-calendar flex-1">
          <style>{`
            .planner-calendar .rbc-timeslot-group { min-height: 64px; }
            .planner-calendar .rbc-time-slot { min-height: 16px; }
            .planner-calendar .rbc-event { padding: 0; }
            .planner-calendar .rbc-event-label { display: none; }
            .planner-calendar .rbc-day-slot .rbc-event { border-radius: 6px; }
          `}</style>
          <DnDCalendar
            localizer={localizer}
            events={calEvents}
            date={date}
            onNavigate={setDate}
            view={view}
            views={["week"]}
            toolbar={false}
            step={15}
            timeslots={4}
            min={new Date(1970, 0, 1, 8, 0)}
            max={new Date(1970, 0, 1, 19, 0)}
            style={{ height: "100%" }}
            eventPropGetter={(event: CalEvent) => ({
              style: { backgroundColor: TYPE_META[event.resource.type].color, border: "none" },
            })}
            components={{
              event: ({ event }: { event: CalEvent }) => {
                const timeLabel = event.start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
                const fullText = [
                  timeLabel,
                  event.title,
                  event.resource.note,
                ]
                  .filter(Boolean)
                  .join(" — ");
                return (
                  <div
                    title={fullText}
                    className="group relative h-full text-white"
                    style={{ overflow: "hidden", width: "100%" }}
                  >
                    <span
                      style={{
                        display: "block",
                        width: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: "10px",
                        lineHeight: "1.2",
                        padding: "1px 16px 1px 4px",
                      }}
                    >
                      {event.title}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteEvent(event.id); }}
                      className="absolute right-0 top-0 rounded bg-black/10 p-0.5 text-white/0 group-hover:text-white/80 hover:!text-white"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                );
              },
            }}
            onEventDrop={({ event, start, end }: EventInteractionArgs<CalEvent>) =>
              persistUpdate(event.id, { start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString() })
            }
            onEventResize={({ event, start, end }: EventInteractionArgs<CalEvent>) =>
              persistUpdate(event.id, { start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString() })
            }
            resizable
            selectable
            onSelectEvent={(event: CalEvent) => setSelectedId(event.id)}
            draggableAccessor={() => true}
            onDropFromOutside={({ start, end }: DragFromOutsideItemArgs) => {
              if (!dragCandidate) return;
              createEvent(
                dragCandidate.account_id,
                dragCandidate.type,
                dragCandidate.title,
                null,
                new Date(start),
                new Date(end)
              );
              setDragCandidate(null);
            }}
            dragFromOutsideItem={() =>
              dragCandidate
                ? ({
                    id: "ghost",
                    title: dragCandidate.title,
                    start: new Date(),
                    end: new Date(Date.now() + 45 * 60000),
                    resource: {} as PlanningEvent,
                  } as CalEvent)
                : (undefined as unknown as CalEvent)
            }
          />
        </div>
      </div>

      {/* ── Fiche détaillée : ce qu'il faut faire chez ce compte ─────────── */}
      {selectedEvent && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedId(null)} />
          <div className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col overflow-y-auto border-l border-border bg-surface p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: TYPE_META[selectedEvent.type].color }}>
                  {TYPE_META[selectedEvent.type].label}
                </p>
                <h3 className="mt-0.5 text-base font-semibold text-foreground">{selectedEvent.title}</h3>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-foreground">
                <X size={18} />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock size={13} />
              {new Date(selectedEvent.start_at).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
              {" → "}
              {new Date(selectedEvent.end_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </div>

            {selectedAccount && (
              <div className="mt-4 space-y-3">
                <Link
                  href={`/comptes/${selectedAccount.id}`}
                  className="block rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100"
                >
                  Ouvrir la fiche compte →
                </Link>

                <div className="rounded-lg border border-border p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Target size={12} /> Quoi faire chez ce compte
                  </p>
                  <p className="mt-1.5 text-sm text-foreground">
                    {selectedEvent.note || "Aucune mission spécifique — se référer au score de ciblage sur la fiche compte."}
                  </p>
                </div>

                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prévisionnel</p>
                  {selectedForecast ? (
                    <p className="mt-1.5 text-sm text-foreground">
                      {formatNumber(selectedForecast.boites_prevues)} boîtes · {formatEUR(selectedForecast.ca_prevu)}
                      {" "}
                      ({MONTH_LABELS[selectedForecast.month - 1]} {selectedForecast.year})
                      {selectedForecast.commentaire && (
                        <span className="mt-1 block text-xs text-muted-foreground">{selectedForecast.commentaire}</span>
                      )}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-sm text-muted-foreground">Aucune prévision en cours pour ce compte.</p>
                  )}
                </div>

                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dernière commande</p>
                  <p className="mt-1.5 text-sm text-foreground">
                    {selectedAccount.last_order_date
                      ? new Date(selectedAccount.last_order_date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
                      : "Aucune commande enregistrée"}
                    {selectedAccount.jours_silence != null && (
                      <span className="ml-1 text-xs text-muted-foreground">({selectedAccount.jours_silence} j sans commande)</span>
                    )}
                  </p>
                </div>

                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Score de ciblage</p>
                  <p className="mt-1.5 text-sm text-foreground">{computeTargetingScore(selectedAccount).total}/100</p>
                </div>
              </div>
            )}

            {!selectedAccount && selectedEvent.type !== "visite" && selectedEvent.type !== "visite_prospect" && (
              <div className="mt-4 rounded-lg border border-border p-3">
                <p className="text-sm text-foreground">{selectedEvent.note || "Créneau sans détail particulier."}</p>
              </div>
            )}

            <button
              onClick={() => { deleteEvent(selectedEvent.id); setSelectedId(null); }}
              className="mt-auto flex items-center justify-center gap-1.5 rounded-lg border border-danger/30 py-2 text-sm font-medium text-danger hover:bg-danger/5"
            >
              <Trash2 size={14} /> Supprimer ce créneau
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SidebarSection({
  title,
  color,
  items,
  onDragStart,
}: {
  title: string;
  color: string;
  items: { key: string; label: string; sub: string; account_id: string; type: PlanningEventType }[];
  onDragStart: (c: { account_id: string; type: PlanningEventType; title: string }) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        {title} ({items.length})
      </p>
      <div className="space-y-1">
        {items.map((it) => (
          <div
            key={it.key}
            draggable
            onDragStart={() => onDragStart({ account_id: it.account_id, type: it.type, title: it.label })}
            className="cursor-grab rounded-lg border border-border bg-surface-muted px-2 py-1.5 text-xs active:cursor-grabbing"
          >
            <p className="truncate font-medium text-foreground">{it.label}</p>
            <p className="truncate text-[10px] text-muted-foreground">{it.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
