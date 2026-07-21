"use client";

import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatEUR, formatNumber } from "@/lib/utils";
import { suggestMonthlyForecast } from "@/lib/forecast";
import { PRIX_MOYEN_BOITE } from "@/lib/scoring";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import type { Account, AccountForecast, ForecastKind } from "@/types/database";
import { Plus, Trash2, Loader2, Sparkles, CalendarRange, CalendarPlus, DownloadCloud } from "lucide-react";

const MONTH_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

type Period = "mois" | "trimestre" | "semestre" | "annee";
type SortKey = "period" | "boites" | "ca";

function quarterOf(month: number) {
  return Math.ceil(month / 3);
}
function semesterOf(month: number) {
  return month <= 6 ? 1 : 2;
}

export function ForecastPanel({
  accountId,
  account,
  initialForecasts,
  kind,
  monthlySales = [],
}: {
  accountId: string;
  account: Account;
  initialForecasts: AccountForecast[];
  kind: ForecastKind;
  monthlySales?: { year: number; month: number; ca: number }[];
}) {
  const [forecasts, setForecasts] = useState(
    initialForecasts.filter((f) => f.kind === kind).sort((a, b) => a.year - b.year || a.month - b.month)
  );
  const [isPending, startTransition] = useTransition();
  const now = new Date();
  const [newYear, setNewYear] = useState(now.getFullYear());
  const [newMonth, setNewMonth] = useState(now.getMonth() + 1);
  const [annualTotal, setAnnualTotal] = useState("");
  const [period, setPeriod] = useState<Period>("mois");

  function addForecast() {
    if (forecasts.some((f) => f.year === newYear && f.month === newMonth)) return;
    const supabase = createClient();
    startTransition(async () => {
      const { data, error } = await supabase
        .from("account_forecasts")
        .insert({ account_id: accountId, year: newYear, month: newMonth, kind, boites_prevues: 0, ca_prevu: 0 })
        .select()
        .single();
      if (!error && data) {
        setForecasts((prev) => [...prev, data as AccountForecast].sort((a, b) => a.year - b.year || a.month - b.month));
      }
    });
  }

  function addFullYear() {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      account_id: accountId,
      year: newYear,
      month: i + 1,
      kind,
      boites_prevues: 0,
      ca_prevu: 0,
    })).filter((r) => !forecasts.some((f) => f.year === r.year && f.month === r.month));
    if (rows.length === 0) return;
    const supabase = createClient();
    startTransition(async () => {
      const { data, error } = await supabase.from("account_forecasts").insert(rows).select();
      if (!error && data) {
        setForecasts((prev) =>
          [...prev, ...(data as AccountForecast[])].sort((a, b) => a.year - b.year || a.month - b.month)
        );
      }
    });
  }

  function suggestNext3Months() {
    const targetMonths: { year: number; month: number }[] = [];
    let y = now.getFullYear();
    let m = now.getMonth() + 1;
    for (let i = 0; i < 3; i++) {
      if (!forecasts.some((f) => f.year === y && f.month === m)) targetMonths.push({ year: y, month: m });
      m++;
      if (m > 12) { m = 1; y++; }
    }
    if (targetMonths.length === 0) return;

    const suggestions = suggestMonthlyForecast(account, targetMonths);
    const supabase = createClient();
    startTransition(async () => {
      const { data, error } = await supabase
        .from("account_forecasts")
        .insert(suggestions.map((s) => ({ account_id: accountId, kind, ...s })))
        .select();
      if (!error && data) {
        setForecasts((prev) =>
          [...prev, ...(data as AccountForecast[])].sort((a, b) => a.year - b.year || a.month - b.month)
        );
      }
    });
  }

  function splitAnnualObjective() {
    const total = Number(annualTotal);
    if (!total || total <= 0) return;
    const perMonth = Math.round(total / 12);
    const rows = Array.from({ length: 12 }, (_, i) => ({
      account_id: accountId,
      year: newYear,
      month: i + 1,
      kind,
      boites_prevues: perMonth,
      ca_prevu: 0,
    })).filter((r) => !forecasts.some((f) => f.year === r.year && f.month === r.month));
    if (rows.length === 0) return;
    const supabase = createClient();
    startTransition(async () => {
      const { data, error } = await supabase.from("account_forecasts").insert(rows).select();
      if (!error && data) {
        setForecasts((prev) =>
          [...prev, ...(data as AccountForecast[])].sort((a, b) => a.year - b.year || a.month - b.month)
        );
        setAnnualTotal("");
      }
    });
  }

  function fillFromOrders() {
    const caParBoite =
      account.realise_boites && account.realise_boites > 0 && account.ca_2026_ytd
        ? account.ca_2026_ytd / account.realise_boites
        : PRIX_MOYEN_BOITE;
    const rows = monthlySales
      .filter((s) => s.ca > 0 && !forecasts.some((f) => f.year === s.year && f.month === s.month))
      .map((s) => ({
        account_id: accountId,
        year: s.year,
        month: s.month,
        kind,
        boites_prevues: caParBoite > 0 ? Math.round(s.ca / caParBoite) : 0,
        ca_prevu: Math.round(s.ca),
        note: "Réalisé recopié depuis les commandes",
      }));
    if (rows.length === 0) return;
    const supabase = createClient();
    startTransition(async () => {
      const { data, error } = await supabase.from("account_forecasts").insert(rows).select();
      if (!error && data) {
        setForecasts((prev) =>
          [...prev, ...(data as AccountForecast[])].sort((a, b) => a.year - b.year || a.month - b.month)
        );
      }
    });
  }

  function updateForecast(id: string, patch: Partial<Pick<AccountForecast, "boites_prevues" | "ca_prevu" | "note">>) {
    setForecasts((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    const supabase = createClient();
    startTransition(async () => {
      await supabase.from("account_forecasts").update(patch).eq("id", id);
    });
  }

  function removeForecast(id: string) {
    setForecasts((prev) => prev.filter((f) => f.id !== id));
    const supabase = createClient();
    startTransition(async () => {
      await supabase.from("account_forecasts").delete().eq("id", id);
    });
  }

  const totalBoites = forecasts.reduce((s, f) => s + (f.boites_prevues ?? 0), 0);
  const totalCa = forecasts.reduce((s, f) => s + (f.ca_prevu ?? 0), 0);

  // Regroupe les mois en trimestre/semestre/année quand la vue le demande —
  // le mois reste la seule granularité éditable, les périodes plus larges
  // sont en lecture seule (somme) pour donner une vision condensée.
  type Row = { key: string; label: string; year: number; sortIdx: number; boites: number; ca: number; forecast?: AccountForecast };

  const rows: Row[] = useMemo(() => {
    if (period === "mois") {
      return forecasts.map((f) => ({
        key: f.id,
        label: `${MONTH_LABELS[f.month - 1]} ${f.year}`,
        year: f.year,
        sortIdx: f.year * 12 + f.month,
        boites: f.boites_prevues ?? 0,
        ca: f.ca_prevu ?? 0,
        forecast: f,
      }));
    }
    const groups = new Map<string, Row>();
    for (const f of forecasts) {
      const idx = period === "trimestre" ? quarterOf(f.month) : period === "semestre" ? semesterOf(f.month) : 1;
      const label = period === "trimestre" ? `T${idx} ${f.year}` : period === "semestre" ? `S${idx} ${f.year}` : `${f.year}`;
      const key = `${f.year}-${idx}`;
      const cur = groups.get(key) ?? { key, label, year: f.year, sortIdx: f.year * 10 + idx, boites: 0, ca: 0 };
      cur.boites += f.boites_prevues ?? 0;
      cur.ca += f.ca_prevu ?? 0;
      groups.set(key, cur);
    }
    return Array.from(groups.values());
  }, [forecasts, period]);

  const { sorted, sortKey, dir, toggle } = useSortableTable<Row, SortKey>(
    rows,
    { period: (r) => r.sortIdx, boites: (r) => r.boites, ca: (r) => r.ca },
    "period",
    "asc"
  );

  // Cumul progressif dans l'ordre affiché — utile pour voir le rythme
  // d'atteinte des opportunités au fil des mois/trimestres.
  const sortedByTime = [...sorted].sort((a, b) => a.sortIdx - b.sortIdx);
  const cumulByKey = new Map<string, number>();
  let running = 0;
  for (const r of sortedByTime) {
    running += r.ca;
    cumulByKey.set(r.key, running);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
        >
          <option value="mois">Vue : Mois</option>
          <option value="trimestre">Vue : Trimestre</option>
          <option value="semestre">Vue : Semestre</option>
          <option value="annee">Vue : Année</option>
        </select>
        {period === "mois" && (
          <>
            <select
              value={newMonth}
              onChange={(e) => setNewMonth(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
            >
              {MONTH_LABELS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <input
              type="number"
              value={newYear}
              onChange={(e) => setNewYear(Number(e.target.value))}
              className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={addForecast}
              disabled={isPending}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
            >
              <Plus size={14} /> Ajouter
            </button>
            <button
              onClick={addFullYear}
              disabled={isPending}
              title="Ajoute les 12 mois de l'année sélectionnée (valeurs à 0, à compléter)"
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
            >
              <CalendarPlus size={14} /> Toute l&apos;année
            </button>
            {kind === "prevision" && (
              <button
                onClick={suggestNext3Months}
                disabled={isPending}
                title="Propose une répartition basée sur l'objectif restant, le score et le rythme réel du compte"
                className="flex items-center gap-1 rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50"
              >
                <Sparkles size={14} /> Suggérer 3 mois
              </button>
            )}
            {kind === "objectif" && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={annualTotal}
                  onChange={(e) => setAnnualTotal(e.target.value)}
                  placeholder="Objectif annuel (boîtes)"
                  className="w-40 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
                />
                <button
                  onClick={splitAnnualObjective}
                  disabled={isPending || !annualTotal}
                  title="Répartit l'objectif annuel à parts égales sur les 12 mois de l'année sélectionnée"
                  className="flex items-center gap-1 rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50"
                >
                  <CalendarRange size={14} /> Répartir sur l&apos;année
                </button>
              </div>
            )}
            {kind === "realise" && monthlySales.length > 0 && (
              <button
                onClick={fillFromOrders}
                disabled={isPending}
                title="Recopie le CA réellement facturé (commandes importées) dans le réalisé, pour les mois pas encore saisis"
                className="flex items-center gap-1 rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50"
              >
                <DownloadCloud size={14} /> Remplir depuis les commandes
              </button>
            )}
          </>
        )}
        {isPending && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
        <span className="ml-auto text-xs text-muted-foreground">
          Total : {formatNumber(totalBoites)} boîtes · {formatEUR(totalCa)}
        </span>
      </div>

      {forecasts.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {kind === "objectif"
            ? "Aucun objectif défini — saisissez un objectif annuel ci-dessus pour le répartir sur les 12 mois, ou ajoutez un mois manuellement."
            : kind === "realise"
            ? "Aucun réalisé saisi — cliquez \"Remplir depuis les commandes\" pour recopier le CA facturé, ou ajoutez un mois manuellement."
            : "Aucune prévision — cliquez \"Suggérer 3 mois\" pour une proposition basée sur ce compte, ou ajoutez un mois manuellement."}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <SortableTh
                label={period === "mois" ? "Mois" : period === "trimestre" ? "Trimestre" : period === "semestre" ? "Semestre" : "Année"}
                sortKey="period"
                activeKey={sortKey}
                dir={dir}
                onSort={toggle}
                className="px-4"
              />
              <SortableTh label="Boîtes" sortKey="boites" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
              <SortableTh label="CA" sortKey="ca" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
              <th className="px-3 py-2 text-right font-medium">Cumul CA</th>
              {period === "mois" && <th className="px-3 py-2 font-medium">Note</th>}
              {period === "mois" && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-foreground">{r.label}</td>
                {period === "mois" && r.forecast ? (
                  <>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        defaultValue={r.forecast.boites_prevues ?? 0}
                        onBlur={(e) => updateForecast(r.forecast!.id, { boites_prevues: Number(e.target.value) })}
                        className="w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-border focus:border-primary focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        defaultValue={r.forecast.ca_prevu ?? 0}
                        onBlur={(e) => updateForecast(r.forecast!.id, { ca_prevu: Number(e.target.value) })}
                        className="w-28 rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-border focus:border-primary focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatEUR(cumulByKey.get(r.key) ?? 0)}</td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        defaultValue={r.forecast.note ?? ""}
                        placeholder={kind === "objectif" ? "ex. objectif révisé..." : "ex. offre prévue, RDV programmé..."}
                        onBlur={(e) => updateForecast(r.forecast!.id, { note: e.target.value || null })}
                        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-primary focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <button onClick={() => removeForecast(r.forecast!.id)} className="text-muted-foreground hover:text-danger">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-right font-medium text-foreground">{formatNumber(r.boites)}</td>
                    <td className="px-3 py-2 text-right font-medium text-foreground">{formatEUR(r.ca)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatEUR(cumulByKey.get(r.key) ?? 0)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
