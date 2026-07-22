"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { predictPortfolioForecast, suggestMonthlyForecast, allocateToHcps } from "@/lib/forecast";
import type { HcpLite } from "@/lib/forecast";
import { detectOpportunities, OPPORTUNITY_META } from "@/lib/opportunities";
import type { Opportunity } from "@/lib/opportunities";
import { computeTargetingScore } from "@/lib/scoring";
import { isProspect } from "@/lib/accounts";
import { SegmentBadge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { formatEUR, formatNumber, formatPct } from "@/lib/utils";
import type { Account, AccountForecast, Hcp, SectorObjective } from "@/types/database";
import { GripVertical, Trash2, Loader2, Target, Wand2, Stethoscope } from "lucide-react";

type HcpRow = Pick<Hcp, "id" | "account_id" | "name" | "potentiel_boites">;
type ProductRow = { brand: string; sales_value_ly: number | null; sales_value_cy: number | null };
type CardSort = "ca" | "boites" | "score" | "nom" | "silence";
const SEGMENTS = ["A", "B", "C", "D", "E"] as const;

const MONTH_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

interface MonthlySale {
  account_id: string;
  year: number;
  month: number;
  ca: number;
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
  hcps,
  products,
  sectorObjectives,
}: {
  accounts: Account[];
  initialForecasts: AccountForecast[];
  monthlySales: MonthlySale[];
  hcps: HcpRow[];
  products: ProductRow[];
  sectorObjectives: SectorObjective[];
}) {
  const [forecasts, setForecasts] = useState(initialForecasts);
  const [isSaving, setIsSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [horizon, setHorizon] = useState<1 | 3 | 6>(3);
  const [cardSort, setCardSort] = useState<CardSort>("ca");

  const months = useMemo(() => nextMonths(horizon), [horizon]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const hcpsByAccount = useMemo(() => {
    const map = new Map<string, HcpLite[]>();
    for (const h of hcps) {
      if (!h.account_id) continue;
      const lite: HcpLite = { id: h.id, name: h.name, potentiel_boites: h.potentiel_boites };
      const arr = map.get(h.account_id);
      if (arr) arr.push(lite);
      else map.set(h.account_id, [lite]);
    }
    return map;
  }, [hcps]);

  const opportunities = useMemo(() => detectOpportunities(accounts), [accounts]);
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

  const cumulOpportunites = useMemo(
    () => filteredOpportunities.reduce((s, o) => s + o.value, 0),
    [filteredOpportunities]
  );

  const realiseByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of monthlySales) {
      const key = `${s.year}-${s.month}`;
      map.set(key, (map.get(key) ?? 0) + s.ca);
    }
    return map;
  }, [monthlySales]);

  // Synthèse de planification sur la période affichée (mois / trimestre /
  // semestre selon l'horizon) : combien on planifie, chez qui, prospects,
  // répartition Premium/Pro/Pro+, et le réalisé de la même période.
  const periodSummary = useMemo(() => {
    const keySet = new Set(months.map((m) => `${m.year}-${m.month}`));
    const rows = forecasts.filter((f) => keySet.has(`${f.year}-${f.month}`));
    const totalCa = rows.reduce((s, f) => s + (f.ca_prevu ?? 0), 0);
    const totalBoites = rows.reduce((s, f) => s + (f.boites_prevues ?? 0), 0);
    const accountIds = new Set(rows.map((r) => r.account_id));
    const tiers: Record<"Premium" | "Pro" | "Pro+", number> = { Premium: 0, Pro: 0, "Pro+": 0 };
    let prospects = 0;
    for (const id of accountIds) {
      const acc = accountById.get(id);
      if (!acc) continue;
      if (isProspect(acc)) prospects++;
      if (acc.price_list === "Premium" || acc.price_list === "Pro" || acc.price_list === "Pro+") {
        tiers[acc.price_list]++;
      }
    }
    const realise = months.reduce((s, m) => s + (realiseByMonth.get(`${m.year}-${m.month}`) ?? 0), 0);
    const objectif = months.reduce((s, m) => {
      const o = sectorObjectives.find((x) => x.year === m.year && x.month === m.month);
      return s + (o?.objectif_ca ?? 0);
    }, 0);
    return { totalCa, totalBoites, comptes: accountIds.size, prospects, tiers, realise, objectif };
  }, [forecasts, months, accountById, realiseByMonth, sectorObjectives]);

  const periodLabel = horizon === 1 ? "ce mois" : horizon === 3 ? "ce trimestre" : "ce semestre";

  // CA par segment (année en cours, YTD) — vision portefeuille.
  const caParSegment = useMemo(() => {
    const totals: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const a of accounts) {
      if (a.segment && a.segment in totals) totals[a.segment] += a.ca_2026_ytd ?? 0;
    }
    return totals;
  }, [accounts]);
  const caSegmentMax = Math.max(...SEGMENTS.map((s) => caParSegment[s]), 1);

  // Ventes des références en 2025 (année précédente = sales_value_ly).
  const refs2025 = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of products) totals.set(p.brand, (totals.get(p.brand) ?? 0) + (p.sales_value_ly ?? 0));
    return Array.from(totals.entries())
      .map(([brand, ca]) => ({ brand, ca }))
      .filter((r) => r.ca > 0)
      .sort((a, b) => b.ca - a.ca)
      .slice(0, 8);
  }, [products]);
  const refsMax = Math.max(...refs2025.map((r) => r.ca), 1);

  // Couverture du portefeuille : comptes planifiés vs total, prospects.
  const totalProspects = useMemo(() => accounts.filter(isProspect).length, [accounts]);
  const couverture = accounts.length > 0 ? periodSummary.comptes / accounts.length : 0;
  const atteinteRealise = periodSummary.totalCa > 0 ? periodSummary.realise / periodSummary.totalCa : 0;
  const atteinteObjectif = periodSummary.objectif > 0 ? periodSummary.realise / periodSummary.objectif : 0;

  function forecastsFor(year: number, month: number) {
    const rows = forecasts.filter((f) => f.year === year && f.month === month);
    return rows.sort((a, b) => {
      const accA = accountById.get(a.account_id);
      const accB = accountById.get(b.account_id);
      switch (cardSort) {
        case "boites":
          return (b.boites_prevues ?? 0) - (a.boites_prevues ?? 0);
        case "nom":
          return (accA?.name ?? "").localeCompare(accB?.name ?? "");
        case "score":
          return (accB ? computeTargetingScore(accB).total : 0) - (accA ? computeTargetingScore(accA).total : 0);
        case "silence":
          return (accB?.jours_silence ?? 0) - (accA?.jours_silence ?? 0);
        case "ca":
        default:
          return (b.ca_prevu ?? 0) - (a.ca_prevu ?? 0);
      }
    });
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

  const [autoFilling, setAutoFilling] = useState(false);

  async function autoFillPortfolio() {
    setAutoFilling(true);
    const predictions = predictPortfolioForecast(
      accounts,
      hcpsByAccount,
      monthlySales,
      forecasts.map((f) => ({ account_id: f.account_id, year: f.year, month: f.month })),
      months
    );
    if (predictions.length === 0) {
      setAutoFilling(false);
      return;
    }
    const supabase = createClient();
    // La répartition par médecin est calculée pour l'affichage, pas stockée :
    // seuls le CA et les boîtes au niveau compte partent en base.
    const { data, error } = await supabase
      .from("account_forecasts")
      .insert(
        predictions.map((p) => ({
          account_id: p.account_id,
          year: p.year,
          month: p.month,
          boites_prevues: p.boites_prevues,
          ca_prevu: p.ca_prevu,
          note: p.note,
          kind: "prevision" as const,
        }))
      )
      .select();
    setAutoFilling(false);
    if (!error && data) setForecasts((prev) => [...prev, ...(data as AccountForecast[])]);
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
    <div className="space-y-4">
      {/* ── Encart de planification (adapté à la période) ─────────── */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Planification — {periodLabel}</h3>
          <span className="text-xs text-muted-foreground">
            Horizon : {horizon === 1 ? "1 mois" : horizon === 3 ? "trimestre" : "semestre"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryTile label="CA planifié" value={formatEUR(periodSummary.totalCa)} accent />
          <SummaryTile label="Boîtes planifiées" value={formatNumber(periodSummary.totalBoites)} />
          <SummaryTile label="Comptes planifiés" value={formatNumber(periodSummary.comptes)} />
          <SummaryTile label="Dont prospects" value={formatNumber(periodSummary.prospects)} />
          <SummaryTile
            label="Premium / Pro / Pro+"
            value={`${periodSummary.tiers.Premium} / ${periodSummary.tiers.Pro} / ${periodSummary.tiers["Pro+"]}`}
          />
          <SummaryTile label="Réalisé (période)" value={formatEUR(periodSummary.realise)} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Jauges prévu / objectif / couverture */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avancement — {periodLabel}</p>
            <Gauge label="Réalisé vs prévu" value={atteinteRealise} left={formatEUR(periodSummary.realise)} right={formatEUR(periodSummary.totalCa)} />
            {periodSummary.objectif > 0 && (
              <Gauge label="Réalisé vs objectif" value={atteinteObjectif} left={formatEUR(periodSummary.realise)} right={formatEUR(periodSummary.objectif)} />
            )}
            <Gauge label="Couverture (comptes planifiés)" value={couverture} left={`${periodSummary.comptes}`} right={`${accounts.length}`} />
            <p className="mt-2 text-[11px] text-muted-foreground">
              {totalProspects} prospect(s) au total (sans commande &gt; 12 mois)
            </p>
          </div>

          {/* CA par segment */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">CA par segment (YTD)</p>
            <div className="space-y-2">
              {SEGMENTS.map((s) => (
                <div key={s}>
                  <div className="mb-0.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">Segment {s}</span>
                    <span className="text-muted-foreground">{formatEUR(caParSegment[s])}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-muted">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(caParSegment[s] / caSegmentMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Références vendues 2025 */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Références vendues 2025</p>
            {refs2025.length === 0 ? (
              <p className="text-xs text-muted-foreground">Importez les données produit pour activer cette vue.</p>
            ) : (
              <div className="space-y-2">
                {refs2025.map((r) => (
                  <div key={r.brand}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{r.brand}</span>
                      <span className="text-muted-foreground">{formatEUR(r.ca)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-muted">
                      <div className="h-1.5 rounded-full bg-amber-400" style={{ width: `${(r.ca / refsMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
      {/* ── Rail opportunités ─────────────────────────────────────── */}
      <div className="flex max-h-[calc(100vh-180px)] flex-col rounded-xl border border-border bg-surface">
        <div className="border-b border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Opportunités détectées</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Glissez un compte vers un mois pour planifier l&apos;action
          </p>
          <div className="mt-3 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-700">Cumul opportunités</p>
            <p className="text-lg font-semibold text-primary-700">{formatEUR(cumulOpportunites)}</p>
            <p className="text-[10px] text-primary-700/70">{filteredOpportunities.length} compte(s) en jeu</p>
          </div>
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
      <div>
        <div className="mb-3 flex items-center justify-end gap-2">
          <button
            onClick={autoFillPortfolio}
            disabled={autoFilling}
            title="Remplit automatiquement le prévisionnel de tout le portefeuille sur la période affichée, à partir de la saisonnalité des commandes passées (ou du score/silence à défaut d'historique) — n'écrase jamais un mois déjà renseigné"
            className="mr-auto flex items-center gap-1.5 rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-60"
          >
            {autoFilling ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            Générer le prévisionnel du portefeuille
          </button>
          <span className="text-xs text-muted-foreground">Trier les comptes :</span>
          <select
            value={cardSort}
            onChange={(e) => setCardSort(e.target.value as CardSort)}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-primary"
          >
            <option value="ca">CA prévu</option>
            <option value="boites">Boîtes prévues</option>
            <option value="score">Score</option>
            <option value="silence">Silence</option>
            <option value="nom">Nom</option>
          </select>
          <span className="text-xs text-muted-foreground">Horizon :</span>
          {([1, 3, 6] as const).map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                horizon === h
                  ? "border-primary bg-primary-50 text-primary-700"
                  : "border-border text-muted-foreground hover:bg-surface-muted"
              }`}
            >
              {h === 1 ? "1 mois" : h === 3 ? "Trimestre (3 mois)" : "Semestre (6 mois)"}
            </button>
          ))}
        </div>
        <div
          className={`grid grid-cols-1 gap-3 ${
            horizon === 1 ? "" : horizon === 3 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
          }`}
        >
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
                  const accHcps = hcpsByAccount.get(account.id) ?? [];
                  const allocation = allocateToHcps(accHcps, f.boites_prevues ?? 0, f.ca_prevu ?? 0)
                    .filter((h) => h.ca > 0)
                    .sort((a, b) => b.ca - a.ca);
                  return (
                    <div key={f.id} className="rounded-lg border border-border bg-surface-muted p-2.5">
                      <div className="flex items-start justify-between gap-1">
                        <Link
                          href={`/comptes/${account.id}`}
                          className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary"
                        >
                          {account.name}
                          <ScoreBadge score={computeTargetingScore(account).total} />
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
                      {allocation.length > 0 && (
                        <div className="mt-1.5 space-y-0.5 rounded-md bg-surface px-2 py-1">
                          <p className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                            <Stethoscope size={10} /> Répartition médecins
                          </p>
                          {allocation.slice(0, horizon === 1 ? 6 : 3).map((h) => (
                            <div key={h.hcpId} className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span className="truncate">{h.name}</span>
                              <span className="shrink-0">{formatNumber(h.boites)} b · {formatEUR(h.ca)}</span>
                            </div>
                          ))}
                          {allocation.length > (horizon === 1 ? 6 : 3) && (
                            <p className="text-[10px] text-muted-foreground/70">+{allocation.length - (horizon === 1 ? 6 : 3)} autre(s)</p>
                          )}
                        </div>
                      )}
                      {f.note && (
                        <p className={`mt-1 text-[10px] text-muted-foreground ${horizon === 1 ? "" : "line-clamp-2"}`}>
                          {f.note}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? "border-primary-100 bg-primary-50" : "border-border"}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent ? "text-primary-700" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function Gauge({ label, value, left, right }: { label: string; value: number; left: string; right: string }) {
  const pct = Math.min(Math.max(value, 0), 1);
  const color = pct >= 1 ? "bg-success" : pct >= 0.6 ? "bg-primary" : "bg-amber-400";
  return (
    <div className="mb-2.5">
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{formatPct(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-muted">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{left}</span>
        <span>{right}</span>
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
