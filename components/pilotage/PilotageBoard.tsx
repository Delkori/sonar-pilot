"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { suggestMonthlyForecast } from "@/lib/forecast";
import { detectOpportunities, OPPORTUNITY_META } from "@/lib/opportunities";
import type { Opportunity } from "@/lib/opportunities";
import { SegmentBadge } from "@/components/ui/Badge";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { Account, AccountForecast } from "@/types/database";
import { GripVertical, Trash2, Loader2, Target } from "lucide-react";

const MONTH_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

interface MonthlySale {
  account_id: string;
  year: number;
  month: number;
  ca: number;
}

interface ProductRow {
  account_id: string;
  brand: string;
  qty_ordered_cy: number | null;
}

function nextMonths(count: number): { year: number; month: number }[] {
  const now = new Date();
  const result: { year: number; month: number }[] = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i < count; i++) {
    result.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return result;
}

export function PilotageBoard({
  accounts,
  initialForecasts,
  monthlySales,
  products,
}: {
  accounts: Account[];
  initialForecasts: AccountForecast[];
  monthlySales: MonthlySale[];
  products: ProductRow[];
}) {
  const [forecasts, setForecasts] = useState(initialForecasts);
  const [isSaving, setIsSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const months = useMemo(() => nextMonths(4), []);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);

  const productsByAccount = useMemo(() => {
    const map = new Map<string, { brand: string; qty: number }[]>();
    for (const p of products) {
      if (!map.has(p.account_id)) map.set(p.account_id, []);
      map.get(p.account_id)!.push({ brand: p.brand, qty: p.qty_ordered_cy ?? 0 });
    }
    return map;
  }, [products]);
  const totalBrandCount = useMemo(() => new Set(products.map((p) => p.brand)).size, [products]);

  const opportunities = useMemo(
    () => detectOpportunities(accounts, productsByAccount, totalBrandCount),
    [accounts, productsByAccount, totalBrandCount]
  );
  const opportunityByAccount = useMemo(
    () => new Map(opportunities.map((o) => [o.account.id, o] as const)),
    [opportunities]
  );

  const filteredOpportunities = useMemo(
    () =>
      opportunities.filter((o) =>
        filter ? o.account.name.toLowerCase().includes(filter.toLowerCase()) : true
      ),
    [opportunities, filter]
  );

  const realiseByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of monthlySales) {
      const key = `${s.year}-${s.month}`;
      map.set(key, (map.get(key) ?? 0) + s.ca);
    }
    return map;
  }, [monthlySales]);

  function forecastsFor(year: number, month: number) {
    return forecasts.filter((f) => f.year === year && f.month === month);
  }

  async function handleDrop(accountId: string, year: number, month: number) {
    setDropTarget(null);
    setDragging(null);
    const account = accountById.get(accountId);
    if (!account) return;
    if (forecasts.some((f) => f.account_id === accountId && f.year === year && f.month === month)) return;

    const [suggestion] = suggestMonthlyForecast(account, [{ year, month }]);
    const opp = opportunityByAccount.get(accountId);
    const note = opp ? `${opp.label} — ${opp.reason}` : suggestion.note;

    setIsSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("account_forecasts")
      .insert({
        account_id: accountId,
        year,
        month,
        boites_prevues: suggestion.boites_prevues,
        ca_prevu: suggestion.ca_prevu,
        note,
      })
      .select()
      .single();
    setIsSaving(false);
    if (!error && data) setForecasts((prev) => [...prev, data as AccountForecast]);
  }

  async function removeForecast(id: string) {
    setForecasts((prev) => prev.filter((f) => f.id !== id));
    const supabase = createClient();
    await supabase.from("account_forecasts").delete().eq("id", id);
  }

  async function updateForecastCa(id: string, ca_prevu: number) {
    setForecasts((prev) => prev.map((f) => (f.id === id ? { ...f, ca_prevu } : f)));
    const supabase = createClient();
    await supabase.from("account_forecasts").update({ ca_prevu }).eq("id", id);
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
      {/* ── Rail opportunités ─────────────────────────────────────── */}
      <div className="flex max-h-[calc(100vh-180px)] flex-col rounded-xl border border-border bg-surface">
        <div className="border-b border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Opportunités détectées</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Glissez un compte vers un mois pour planifier l&apos;action
          </p>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer..."
            className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {filteredOpportunities.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aucune opportunité détectée — importez vos fichiers pour alimenter l&apos;analyse.
            </p>
          )}
          {filteredOpportunities.slice(0, 40).map((opp) => (
            <OpportunityCard
              key={opp.account.id}
              opportunity={opp}
              isDragging={dragging === opp.account.id}
              onDragStart={() => setDragging(opp.account.id)}
              onDragEnd={() => { setDragging(null); setDropTarget(null); }}
            />
          ))}
        </div>
      </div>

      {/* ── Colonnes mois ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {months.map(({ year, month }) => {
          const monthForecasts = forecastsFor(year, month);
          const totalPrevu = monthForecasts.reduce((s, f) => s + (f.ca_prevu ?? 0), 0);
          const realise = realiseByMonth.get(`${year}-${month}`) ?? 0;
          const atteinte = totalPrevu > 0 ? Math.min(realise / totalPrevu, 1) : 0;
          const key = `${year}-${month}`;
          const isTarget = dropTarget === key;

          return (
            <div
              key={key}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(key); }}
              onDragLeave={() => setDropTarget((t) => (t === key ? null : t))}
              onDrop={(e) => {
                e.preventDefault();
                const accountId = e.dataTransfer.getData("text/account-id");
                if (accountId) handleDrop(accountId, year, month);
              }}
              className={`flex min-h-[420px] flex-col rounded-xl border bg-surface transition-colors ${
                isTarget ? "border-primary bg-primary-50/50" : "border-border"
              }`}
            >
              <div className="border-b border-border p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground">
                    {MONTH_LABELS[month - 1]} <span className="text-muted-foreground">{year}</span>
                  </h4>
                  {isSaving && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Prévu</span>
                  <span className="font-medium text-foreground">{formatEUR(totalPrevu)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Réalisé</span>
                  <span className={`font-medium ${realise >= totalPrevu && totalPrevu > 0 ? "text-success" : "text-foreground"}`}>
                    {formatEUR(realise)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-surface-muted">
                  <div
                    className={`h-1.5 rounded-full ${atteinte >= 1 ? "bg-success" : "bg-primary"}`}
                    style={{ width: `${atteinte * 100}%` }}
                  />
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-2">
                {monthForecasts.length === 0 && (
                  <div className="flex h-full min-h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                    Déposez un compte ici
                  </div>
                )}
                {monthForecasts.map((f) => {
                  const account = accountById.get(f.account_id);
                  if (!account) return null;
                  return (
                    <div key={f.id} className="rounded-lg border border-border bg-surface-muted p-2.5">
                      <div className="flex items-start justify-between gap-1">
                        <Link
                          href={`/comptes/${account.id}`}
                          className="text-xs font-medium text-foreground hover:text-primary"
                        >
                          {account.name}
                        </Link>
                        <button
                          onClick={() => removeForecast(f.id)}
                          className="shrink-0 text-muted-foreground hover:text-danger"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <Target size={11} />
                        {formatNumber(f.boites_prevues)} boîtes ·
                        <input
                          type="number"
                          defaultValue={f.ca_prevu ?? 0}
                          onBlur={(e) => updateForecastCa(f.id, Number(e.target.value))}
                          className="w-20 rounded border border-transparent bg-transparent px-1 text-right hover:border-border focus:border-primary focus:outline-none"
                        />
                        €
                      </div>
                      {f.note && <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{f.note}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OpportunityCard({
  opportunity,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  opportunity: Opportunity;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const meta = OPPORTUNITY_META[opportunity.type];
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/account-id", opportunity.account.id);
        e.dataTransfer.effectAllowed = "copy";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`cursor-grab rounded-lg border border-border bg-surface p-2.5 transition-opacity active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <GripVertical size={13} className="shrink-0 text-muted-foreground" />
        <SegmentBadge segment={opportunity.account.segment} />
        <span className="truncate text-xs font-medium text-foreground">{opportunity.account.name}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
          style={{ backgroundColor: meta.color }}
        >
          {meta.label}
        </span>
        <span className="text-[10px] font-medium text-muted-foreground">{formatEUR(opportunity.value)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{opportunity.reason}</p>
    </div>
  );
}
