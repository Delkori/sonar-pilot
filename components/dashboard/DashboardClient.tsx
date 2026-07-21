"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { PriorityAccountsTable } from "@/components/dashboard/PriorityAccountsTable";
import { QuickActionCard } from "@/components/dashboard/QuickActionCard";
import { formatEUR, formatNumber, formatPct } from "@/lib/utils";
import { suggestMonthlyForecast } from "@/lib/forecast";
import { computeTargetingScore, ACTION_META } from "@/lib/scoring";
import type { ActionCode } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/client";
import {
  TrendingUp,
  Users,
  AlertTriangle,
  Crown,
  PhoneMissed,
  UserX,
  Package,
  Sparkles,
  Loader2,
  Wallet,
  Target,
  CalendarCheck,
  UserPlus,
} from "lucide-react";
import type { Account } from "@/types/database";
import Link from "next/link";

const YEAR_FIELDS: Record<number, keyof Account> = {
  2024: "ca_2024",
  2025: "ca_2025",
  2026: "ca_2026_ytd",
};
const YEARS = [2024, 2025, 2026];
const MONTH_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

interface MonthlySale {
  account_id: string;
  year: number;
  month: number;
  ca: number;
}

interface ProductRow {
  account_id: string;
  brand: string;
  sales_value_ly: number | null;
  sales_value_cy: number | null;
  growth_rate_pct: number | null;
}

interface ForecastRow {
  account_id: string;
  year: number;
  month: number;
  boites_prevues: number | null;
  ca_prevu: number | null;
}

export function DashboardClient({
  accounts,
  monthlySales,
  products,
  forecasts,
  objectifs,
  lastImportLabel,
}: {
  accounts: Account[];
  monthlySales: MonthlySale[];
  products: ProductRow[];
  forecasts: ForecastRow[];
  objectifs: ForecastRow[];
  lastImportLabel: string;
}) {
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState<number | null>(null); // null = vue annuelle

  const availableMonthsByYear = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const s of monthlySales) {
      if (!map.has(s.year)) map.set(s.year, new Set());
      map.get(s.year)!.add(s.month);
    }
    return map;
  }, [monthlySales]);

  const monthsForYear = Array.from(availableMonthsByYear.get(year) ?? []).sort((a, b) => a - b);
  const hasMonthlyData = monthsForYear.length > 0;

  // ── Score de ciblage calculé pour chaque compte — base de tout le reste
  const scored = useMemo(() => accounts.map((a) => ({ account: a, score: computeTargetingScore(a) })), [accounts]);
  const caPotentielTotal = useMemo(() => scored.reduce((s, r) => s + r.score.caNonCapte, 0), [scored]);

  const actionDistribution = useMemo(() => {
    const buckets = new Map<ActionCode, { count: number; caNonCapte: number }>();
    for (const { score } of scored) {
      const cur = buckets.get(score.action) ?? { count: 0, caNonCapte: 0 };
      cur.count++;
      cur.caNonCapte += score.caNonCapte;
      buckets.set(score.action, cur);
    }
    return (Object.keys(ACTION_META) as ActionCode[])
      .map((code) => ({ code, meta: ACTION_META[code], ...(buckets.get(code) ?? { count: 0, caNonCapte: 0 }) }))
      .filter((b) => b.count > 0);
  }, [scored]);

  const caYear = useMemo(
    () => accounts.reduce((sum, a) => sum + ((a[YEAR_FIELDS[year]] as number | null) ?? 0), 0),
    [accounts, year]
  );
  const caPrevYear = useMemo(() => {
    const field = YEAR_FIELDS[year - 1];
    if (!field) return null;
    return accounts.reduce((sum, a) => sum + ((a[field] as number | null) ?? 0), 0);
  }, [accounts, year]);
  const caYoyGrowth = caPrevYear && caPrevYear > 0 ? (caYear - caPrevYear) / caPrevYear : null;

  const caMonth = useMemo(() => {
    if (month === null) return null;
    return monthlySales.filter((s) => s.year === year && s.month === month).reduce((sum, s) => sum + s.ca, 0);
  }, [monthlySales, year, month]);

  const caByMonthOfYear = useMemo(() => {
    const arr = new Array(12).fill(0);
    for (const s of monthlySales) {
      if (s.year === year) arr[s.month - 1] += s.ca;
    }
    return arr;
  }, [monthlySales, year]);

  // ── Objectif réel (assigné, kind='objectif') vs réalisé, pour la période sélectionnée
  const objectifCaSelected = useMemo(() => {
    return objectifs
      .filter((o) => o.year === year && (month === null || o.month === month))
      .reduce((s, o) => s + (o.ca_prevu ?? 0), 0);
  }, [objectifs, year, month]);
  const objectifBoitesSelected = useMemo(() => {
    return objectifs
      .filter((o) => o.year === year && (month === null || o.month === month))
      .reduce((s, o) => s + (o.boites_prevues ?? 0), 0);
  }, [objectifs, year, month]);
  const realiseCaSelected = month === null ? caYear : caMonth ?? 0;
  const ecartCa = realiseCaSelected - objectifCaSelected;
  const atteinteCa = objectifCaSelected > 0 ? realiseCaSelected / objectifCaSelected : null;
  const hasObjectifData = objectifCaSelected > 0 || objectifBoitesSelected > 0;

  const objectifByMonthOfYear = useMemo(() => {
    const arr = new Array(12).fill(0);
    for (const o of objectifs) {
      if (o.year === year) arr[o.month - 1] += o.ca_prevu ?? 0;
    }
    return arr;
  }, [objectifs, year]);
  const hasObjectifForYear = objectifs.some((o) => o.year === year);

  const forecastByMonthOfYear = useMemo(() => {
    const boites = new Array(12).fill(0);
    const ca = new Array(12).fill(0);
    for (const f of forecasts) {
      if (f.year === year) {
        boites[f.month - 1] += f.boites_prevues ?? 0;
        ca[f.month - 1] += f.ca_prevu ?? 0;
      }
    }
    return { boites, ca };
  }, [forecasts, year]);
  const hasForecastData = forecasts.some((f) => f.year === year);

  const clientsActifs = accounts.filter((a) => a.status === "actif").length;
  const clientsAlerte = accounts.filter(
    (a) => a.status === "lost" || a.status === "a_risque" || (a.jours_silence ?? 0) > 90
  );
  const caMoyenParCompteActif = clientsActifs > 0 ? caYear / clientsActifs : 0;

  // ── Suivi prévision / prospects
  const accountsAvecPrevision = useMemo(() => new Set(forecasts.map((f) => f.account_id)), [forecasts]);
  const clientsActifsEnPrevision = accounts.filter(
    (a) => a.status === "actif" && accountsAvecPrevision.has(a.id)
  ).length;
  const nouveauxProspects = accounts.filter((a) => a.status === "new").length;

  // ── Suivi Premium / Pro / Pro+ (tier stocké dans price_list)
  const tierStats = useMemo(() => {
    const tiers = ["Premium", "Pro", "Pro+"] as const;
    const caField = YEAR_FIELDS[year];
    return tiers.map((tier) => {
      const list = accounts.filter((a) => a.price_list === tier);
      const ca = list.reduce((s, a) => s + ((a[caField] as number | null) ?? 0), 0);
      const objectif = list.reduce((s, a) => s + (a.objectif_boites ?? 0), 0);
      const potentiel = list.reduce((s, a) => s + ((a.potentiel_boites ?? 0) * 133.66), 0);
      return { tier, count: list.length, ca, objectif, potentiel };
    });
  }, [accounts, year]);
  const hasTierData = tierStats.some((t) => t.count > 0);

  const accountsAvecHistorique = accounts.filter(
    (a) => a.ca_2024 !== null || a.ca_2025 !== null || a.ca_2026_ytd !== null
  ).length;

  const caParSegment = useMemo(() => {
    const totals: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const a of accounts) {
      if (a.segment) totals[a.segment] += (a[YEAR_FIELDS[year]] as number | null) ?? 0;
    }
    return totals;
  }, [accounts, year]);
  const concentrationSegmentA = caYear > 0 ? caParSegment.A / caYear : 0;

  // évolution recalculée à partir du CA réel (factures), plus fiable que
  // l'ancienne colonne PAS evolution_pct qui n'est plus jamais mise à jour
  const withEvolution = useMemo(
    () =>
      accounts
        .filter((a) => (a.ca_2024 ?? 0) > 0)
        .map((a) => ({ account: a, evolution: ((a.ca_2025 ?? 0) - (a.ca_2024 ?? 0)) / (a.ca_2024 ?? 1) })),
    [accounts]
  );
  const topCroissance = [...withEvolution].sort((a, b) => b.evolution - a.evolution).slice(0, 5);
  const topDeclin = [...withEvolution].sort((a, b) => a.evolution - b.evolution).slice(0, 5);

  const lostAccounts = [...accounts]
    .filter((a) => a.status === "lost")
    .sort((a, b) => (b.ca_2025 ?? 0) - (a.ca_2025 ?? 0))
    .slice(0, 10);

  const overdueCallAccounts = [...accounts]
    .filter((a) => a.status === "actif" && (a.days_since_last_call ?? 0) > 60)
    .sort((a, b) => (b.days_since_last_call ?? 0) - (a.days_since_last_call ?? 0))
    .slice(0, 10);

  const salesByBrand = useMemo(() => {
    const totals = new Map<string, { cy: number; ly: number }>();
    for (const p of products) {
      const cur = totals.get(p.brand) ?? { cy: 0, ly: 0 };
      cur.cy += p.sales_value_cy ?? 0;
      cur.ly += p.sales_value_ly ?? 0;
      totals.set(p.brand, cur);
    }
    return Array.from(totals.entries())
      .map(([brand, v]) => ({ brand, ...v }))
      .sort((a, b) => b.cy - a.cy)
      .slice(0, 8);
  }, [products]);
  const hasProductData = products.length > 0;

  // comptes prioritaires = les plus gros scores de ciblage, pas un écart
  // objectif/réalisé flou qui n'a plus de source fiable
  const priorityAccounts = [...scored]
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, 8)
    .map((r) => r.account);

  const [generatingForecasts, setGeneratingForecasts] = useState(false);
  const [forecastGenerationResult, setForecastGenerationResult] = useState<string | null>(null);

  function generatePriorityForecasts() {
    setGeneratingForecasts(true);
    setForecastGenerationResult(null);
    const now = new Date();
    const targetMonths: { year: number; month: number }[] = [];
    let y = now.getFullYear();
    let m = now.getMonth() + 1;
    for (let i = 0; i < 3; i++) {
      targetMonths.push({ year: y, month: m });
      m++;
      if (m > 12) { m = 1; y++; }
    }

    const existingKeys = new Set(forecasts.map((f) => `${f.account_id}|${f.year}|${f.month}`));
    const rows = priorityAccounts.flatMap((account) =>
      suggestMonthlyForecast(account, targetMonths)
        .filter((s) => !existingKeys.has(`${account.id}|${s.year}|${s.month}`))
        .map((s) => ({ account_id: account.id, kind: "prevision" as const, ...s }))
    );

    if (rows.length === 0) {
      setGeneratingForecasts(false);
      setForecastGenerationResult("Ces comptes ont déjà un prévisionnel sur les 3 prochains mois.");
      return;
    }

    const supabase = createClient();
    supabase
      .from("account_forecasts")
      .insert(rows)
      .then(({ error }) => {
        setGeneratingForecasts(false);
        setForecastGenerationResult(
          error
            ? `Erreur : ${error.message}`
            : `${rows.length} prévision(s) générée(s) sur ${priorityAccounts.length} comptes — ouvrez une fiche compte pour ajuster.`
        );
      });
  }

  const displayedCa = month !== null ? caMonth : caYear;
  const displayedCaLabel = month !== null ? `CA réalisé ${MONTH_LABELS[month - 1]} ${year}` : `CA réalisé ${year}`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 border-b border-border bg-surface px-8 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Période</span>
        <div className="flex gap-1">
          {YEARS.map((y) => (
            <button
              key={y}
              onClick={() => {
                setYear(y);
                setMonth(null);
              }}
              className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                year === y ? "bg-primary text-white" : "text-muted-foreground hover:bg-surface-muted"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
        {hasMonthlyData ? (
          <div className="flex flex-wrap gap-1 border-l border-border pl-4">
            <button
              onClick={() => setMonth(null)}
              className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                month === null ? "bg-primary-100 text-primary-700" : "text-muted-foreground hover:bg-surface-muted"
              }`}
            >
              Vue annuelle
            </button>
            {monthsForYear.map((m) => (
              <button
                key={m}
                onClick={() => setMonth(m)}
                className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                  month === m ? "bg-primary-100 text-primary-700" : "text-muted-foreground hover:bg-surface-muted"
                }`}
              >
                {MONTH_LABELS[m - 1]}
              </button>
            ))}
          </div>
        ) : (
          <span className="border-l border-border pl-4 text-xs text-muted-foreground">
            Détail mensuel indisponible — importez Account Detail / Invoice Product pour l&apos;activer
          </span>
        )}
      </div>

      <main className="px-8 py-6 space-y-6">
        <p className="text-xs text-muted-foreground">
          {lastImportLabel} · {accountsAvecHistorique}/{accounts.length} comptes avec historique de CA importé
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="CA potentiel à capter"
            value={formatEUR(caPotentielTotal)}
            trend="Potentiel × prix moyen − CA réalisé"
            icon={Wallet}
          />
          <KpiCard
            label={displayedCaLabel}
            value={formatEUR(displayedCa)}
            trend={month === null && caYoyGrowth !== null ? `${caYoyGrowth > 0 ? "+" : ""}${formatPct(caYoyGrowth)} vs ${year - 1}` : undefined}
            tone={month === null && caYoyGrowth !== null ? (caYoyGrowth >= 0 ? "positive" : "negative") : "default"}
            icon={TrendingUp}
          />
          {hasObjectifData ? (
            <>
              <KpiCard
                label="Objectif CA (période)"
                value={formatEUR(objectifCaSelected)}
                trend={atteinteCa !== null ? `${formatPct(atteinteCa)} atteint` : undefined}
                tone={atteinteCa !== null && atteinteCa >= 1 ? "positive" : "default"}
                icon={Target}
              />
              <KpiCard
                label="Écart vs objectif"
                value={`${ecartCa > 0 ? "+" : ""}${formatEUR(ecartCa)}`}
                tone={ecartCa < 0 ? "negative" : "positive"}
                icon={AlertTriangle}
              />
            </>
          ) : (
            <>
              <KpiCard label="Comptes actifs" value={formatNumber(clientsActifs)} icon={Users} />
              <KpiCard label="Comptes à risque" value={formatNumber(clientsAlerte.length)} tone="negative" icon={AlertTriangle} />
            </>
          )}
        </div>

        {!hasObjectifData && (
          <p className="rounded-lg border border-dashed border-border bg-surface-muted px-4 py-2 text-xs text-muted-foreground">
            Aucun objectif défini pour {month ? `${MONTH_LABELS[month - 1]} ` : ""}
            {year} — allez sur une fiche compte, section &quot;Objectifs mensuels&quot;, pour en saisir (total annuel réparti
            automatiquement sur 12 mois).
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Répartition par action recommandée</CardTitle>
            <CardDescription>Calculée en direct depuis le score de ciblage — {accounts.length} comptes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {actionDistribution.map((b) => (
                <div key={b.code} className="rounded-lg border border-border p-3" style={{ borderTopColor: b.meta.color, borderTopWidth: 3 }}>
                  <p className="text-lg font-semibold text-foreground">{b.count}</p>
                  <p className="text-xs text-muted-foreground">{b.meta.label}</p>
                  {b.caNonCapte > 0 && <p className="mt-1 text-[10px] text-muted-foreground">{formatEUR(b.caNonCapte)}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="CA moyen / compte actif" value={formatEUR(caMoyenParCompteActif)} icon={TrendingUp} />
          <KpiCard label="Concentration Segment A" value={formatPct(concentrationSegmentA)} icon={Crown} />
          <KpiCard label="Clients actifs" value={formatNumber(clientsActifs)} icon={Users} />
          <KpiCard label="Comptes à risque" value={formatNumber(clientsAlerte.length)} tone="negative" icon={AlertTriangle} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Clients actifs en prévision"
            value={formatNumber(clientsActifsEnPrevision)}
            trend={`sur ${clientsActifs} actifs`}
            icon={CalendarCheck}
          />
          <KpiCard label="Nouveaux prospects" value={formatNumber(nouveauxProspects)} icon={UserPlus} />
          <KpiCard
            label="Comptes avec prévisionnel"
            value={formatNumber(accountsAvecPrevision.size)}
            trend={`sur ${accounts.length} comptes`}
            icon={Target}
          />
          <KpiCard label="Comptes perdus" value={formatNumber(accounts.filter((a) => a.status === "lost").length)} tone="negative" icon={UserX} />
        </div>

        {hasTierData && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Suivi Premium / Pro / Pro+</CardTitle>
                <CardDescription>Comptes sous contrat de partenariat — CA {year} vs potentiel</CardDescription>
              </div>
              <Crown size={18} className="text-primary" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {tierStats.map((t) => {
                  const atteinte = t.potentiel > 0 ? Math.min(t.ca / t.potentiel, 1) : 0;
                  return (
                    <div key={t.tier} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">{t.tier}</span>
                        <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                          {t.count} compte(s)
                        </span>
                      </div>
                      <p className="mt-2 text-lg font-semibold text-foreground">{formatEUR(t.ca)}</p>
                      <p className="text-xs text-muted-foreground">
                        Objectif {formatNumber(t.objectif)} boîtes · Potentiel {formatEUR(t.potentiel)}
                      </p>
                      <div className="mt-2 h-1.5 rounded-full bg-surface-muted">
                        <div
                          className={`h-1.5 rounded-full ${atteinte >= 0.75 ? "bg-success" : "bg-primary"}`}
                          style={{ width: `${atteinte * 100}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">{formatPct(atteinte)} du potentiel capté</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {month === null && hasMonthlyData && (
          <Card>
            <CardHeader>
              <CardTitle>CA par mois — {year}</CardTitle>
              <CardDescription>Cliquez un mois ci-dessus pour filtrer le dashboard dessus</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2" style={{ height: 120 }}>
                {caByMonthOfYear.map((v, i) => {
                  const max = Math.max(...caByMonthOfYear, 1);
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-primary-100"
                        style={{ height: `${Math.max((v / max) * 90, v > 0 ? 4 : 0)}px` }}
                        title={formatEUR(v)}
                      />
                      <span className="text-[10px] text-muted-foreground">{MONTH_LABELS[i]}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {month === null && hasObjectifForYear && (
          <Card>
            <CardHeader>
              <CardTitle>Objectif vs Réalisé — {year}</CardTitle>
              <CardDescription>Objectif saisi sur les fiches comptes comparé au CA réel importé, mois par mois</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2" style={{ height: 120 }}>
                {objectifByMonthOfYear.map((obj, i) => {
                  const realise = caByMonthOfYear[i];
                  const max = Math.max(...objectifByMonthOfYear, ...caByMonthOfYear, 1);
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <div className="flex h-[90px] w-full items-end gap-0.5">
                        <div
                          className="flex-1 rounded-t bg-amber-200"
                          style={{ height: `${Math.max((obj / max) * 90, obj > 0 ? 4 : 0)}px` }}
                          title={`Objectif : ${formatEUR(obj)}`}
                        />
                        <div
                          className="flex-1 rounded-t bg-primary"
                          style={{ height: `${Math.max((realise / max) * 90, realise > 0 ? 4 : 0)}px` }}
                          title={`Réalisé : ${formatEUR(realise)}`}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{MONTH_LABELS[i]}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-200" /> Objectif</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> Réalisé</span>
              </div>
            </CardContent>
          </Card>
        )}

        {month === null && hasForecastData && (
          <Card>
            <CardHeader>
              <CardTitle>Mon prévisionnel vs Réalisé — {year}</CardTitle>
              <CardDescription>
                CA que vous prévoyez de faire (fiches comptes) comparé au CA réel importé.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2" style={{ height: 120 }}>
                {forecastByMonthOfYear.ca.map((prevu, i) => {
                  const realise = caByMonthOfYear[i];
                  const max = Math.max(...forecastByMonthOfYear.ca, ...caByMonthOfYear, 1);
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <div className="flex h-[90px] w-full items-end gap-0.5">
                        <div
                          className="flex-1 rounded-t bg-slate-300"
                          style={{ height: `${Math.max((prevu / max) * 90, prevu > 0 ? 4 : 0)}px` }}
                          title={`Prévu : ${formatEUR(prevu)}`}
                        />
                        <div
                          className="flex-1 rounded-t bg-primary"
                          style={{ height: `${Math.max((realise / max) * 90, realise > 0 ? 4 : 0)}px` }}
                          title={`Réalisé : ${formatEUR(realise)}`}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{MONTH_LABELS[i]}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300" /> Prévu</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> Réalisé</span>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-1">
            <QuickActionCard accounts={accounts} />
            <Card>
              <CardHeader>
                <CardTitle>Vue management</CardTitle>
                <CardDescription>Synthèse du portefeuille</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Comptes suivis</span>
                  <span className="font-medium">{formatNumber(accounts.length)}</span>
                </div>
                {(["A", "B", "C", "D", "E"] as const).map((seg) => (
                  <div key={seg} className="flex justify-between">
                    <span className="text-muted-foreground">Segment {seg}</span>
                    <span className="font-medium">
                      {accounts.filter((a) => a.segment === seg).length} · {formatEUR(caParSegment[seg])}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle>Comptes prioritaires</CardTitle>
                <CardDescription>Score de ciblage le plus élevé — recalculé en direct</CardDescription>
              </div>
              <button
                onClick={generatePriorityForecasts}
                disabled={generatingForecasts}
                title="Propose un prévisionnel 3 mois pour ces comptes prioritaires"
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50"
              >
                {generatingForecasts ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Générer le prévisionnel
              </button>
            </CardHeader>
            {forecastGenerationResult && (
              <p className="px-5 pb-2 text-xs text-muted-foreground">{forecastGenerationResult}</p>
            )}
            <PriorityAccountsTable accounts={priorityAccounts} />
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MoversCard title="Top 5 croissance (Évol. 24→25)" rows={topCroissance} tone="positive" />
          <MoversCard title="Top 5 déclin (Évol. 24→25)" rows={topDeclin} tone="negative" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Comptes perdus</CardTitle>
                <CardDescription>Statut Lost, triés par CA 2025 (le plus à regagner en premier)</CardDescription>
              </div>
              <UserX size={18} className="text-danger" />
            </CardHeader>
            <CardContent className="space-y-2">
              {lostAccounts.length === 0 && <p className="text-sm text-muted-foreground">Aucun compte perdu 🎉</p>}
              {lostAccounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <div>
                    <Link href={`/comptes/${a.id}`} className="text-foreground hover:text-primary">
                      {a.name}
                    </Link>
                    {a.last_order_date && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        dernière commande {new Date(a.last_order_date).toLocaleDateString("fr-FR")}
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground">{formatEUR(a.ca_2025)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Relances en retard</CardTitle>
                <CardDescription>Comptes actifs sans appel depuis plus de 60 jours</CardDescription>
              </div>
              <PhoneMissed size={18} className="text-warning" />
            </CardHeader>
            <CardContent className="space-y-2">
              {overdueCallAccounts.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {accounts.some((a) => a.days_since_last_call !== null)
                    ? "Rien en retard, bien joué."
                    : "Importez le fichier Appels pour activer ce suivi."}
                </p>
              )}
              {overdueCallAccounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <Link href={`/comptes/${a.id}`} className="text-foreground hover:text-primary">
                    {a.name}
                  </Link>
                  <span className="text-warning">{a.days_since_last_call} j</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>CA par marque</CardTitle>
              <CardDescription>Année en cours vs année précédente, toutes marques confondues</CardDescription>
            </div>
            <Package size={18} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {!hasProductData ? (
              <p className="text-sm text-muted-foreground">Importez le fichier Croissance par marque pour activer cette vue.</p>
            ) : (
              <div className="space-y-3">
                {salesByBrand.map((b) => {
                  const max = Math.max(...salesByBrand.map((s) => s.cy), 1);
                  const growth = b.ly > 0 ? (b.cy - b.ly) / b.ly : null;
                  return (
                    <div key={b.brand}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-foreground">{b.brand}</span>
                        <span className="text-muted-foreground">
                          {formatEUR(b.cy)}
                          {growth !== null && (
                            <span className={`ml-2 ${growth >= 0 ? "text-success" : "text-danger"}`}>
                              {growth > 0 ? "+" : ""}
                              {formatPct(growth)}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-muted">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${(b.cy / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function MoversCard({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: { account: Account; evolution: number }[];
  tone: "positive" | "negative";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Pas assez de données (nécessite CA 2024 et 2025).</p>}
        {rows.map(({ account: a, evolution }) => (
          <div key={a.id} className="flex items-center justify-between text-sm">
            <Link href={`/comptes/${a.id}`} className="text-foreground hover:text-primary">
              {a.name}
            </Link>
            <span className={tone === "positive" ? "text-success" : "text-danger"}>{formatPct(evolution)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
