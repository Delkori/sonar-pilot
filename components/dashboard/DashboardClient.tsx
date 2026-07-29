"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { PriorityAccountsTable } from "@/components/dashboard/PriorityAccountsTable";
import { QuickActionCard } from "@/components/dashboard/QuickActionCard";
import { DepartmentBreakdown, DEPT_NAMES } from "@/components/dashboard/DepartmentBreakdown";
import { InteractiveMonthlyChart } from "@/components/dashboard/InteractiveMonthlyChart";
import { CustomizableLayout, type LayoutBlock } from "@/components/dashboard/CustomizableLayout";
import { TopFlopClientsCard } from "@/components/dashboard/TopFlopClientsCard";
import { ProductSalesComparison, type ProductRow } from "@/components/dashboard/ProductSalesComparison";
import { AnnualObjectiveCard } from "@/components/dashboard/AnnualObjectiveCard";
import { OrderRecurrenceCard } from "@/components/dashboard/OrderRecurrenceCard";
import { CompetitorShareCard } from "@/components/dashboard/CompetitorShareCard";
import type { CompetitorAmount } from "@/lib/nexora/queries";
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
  Sparkles,
  Loader2,
  Wallet,
  Target,
  Percent,
  MapPin,
} from "lucide-react";
import type { Account, AccountAction, Hcp, HcpSponsorship } from "@/types/database";
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
  actions = [],
  hcps = [],
  sponsorships = [],
  competitorAmounts = [],
  lastImportLabel,
}: {
  accounts: Account[];
  monthlySales: MonthlySale[];
  products: ProductRow[];
  forecasts: ForecastRow[];
  objectifs: ForecastRow[];
  actions?: AccountAction[];
  hcps?: Hcp[];
  sponsorships?: HcpSponsorship[];
  competitorAmounts?: CompetitorAmount[];
  lastImportLabel: string;
}) {
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState<number | null>(null); // null = vue annuelle
  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  // ── Filtre des comptes par département
  const filteredAccounts = useMemo(() => {
    if (!selectedDept) return accounts;
    return accounts.filter((a) => {
      const code = a.department_code || (a.postal_code ? a.postal_code.slice(0, 2) : "");
      return code === selectedDept;
    });
  }, [accounts, selectedDept]);

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

  // ── Score de ciblage calculé pour chaque compte du périmètre
  const scored = useMemo(
    () => filteredAccounts.map((a) => ({ account: a, score: computeTargetingScore(a) })),
    [filteredAccounts]
  );
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
    () => filteredAccounts.reduce((sum, a) => sum + ((a[YEAR_FIELDS[year]] as number | null) ?? 0), 0),
    [filteredAccounts, year]
  );
  const filteredAccountIds = useMemo(() => new Set(filteredAccounts.map((a) => a.id)), [filteredAccounts]);

  // ── Rythme YTD vs N-1 : comparer le CA depuis le 1er janvier jusqu'au même
  // mois l'an dernier (pas le total de l'année entière, qui rend l'année en
  // cours artificiellement "en retard" puisqu'elle n'est pas terminée).
  const ytdPace = useMemo(() => {
    if (monthsForYear.length === 0) return null;
    const cutoffMonth = Math.max(...monthsForYear);
    const sumThroughMonth = (y: number) =>
      monthlySales
        .filter((s) => s.year === y && s.month <= cutoffMonth && filteredAccountIds.has(s.account_id))
        .reduce((sum, s) => sum + s.ca, 0);
    const cur = sumThroughMonth(year);
    const prev = sumThroughMonth(year - 1);
    const growth = prev > 0 ? (cur - prev) / prev : null;
    return { cutoffMonth, cur, prev, growth };
  }, [monthlySales, year, filteredAccountIds, monthsForYear]);

  const caMonth = useMemo(() => {
    if (month === null) return null;
    return monthlySales
      .filter((s) => s.year === year && s.month === month && filteredAccountIds.has(s.account_id))
      .reduce((sum, s) => sum + s.ca, 0);
  }, [monthlySales, year, month, filteredAccountIds]);

  const caByMonthOfYear = useMemo(() => {
    const arr = new Array(12).fill(0);
    for (const s of monthlySales) {
      if (s.year === year && filteredAccountIds.has(s.account_id)) {
        arr[s.month - 1] += s.ca;
      }
    }
    return arr;
  }, [monthlySales, year, filteredAccountIds]);

  // ── Objectifs & Prévisions
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

  const forecastByMonthOfYear = useMemo(() => {
    const boites = new Array(12).fill(0);
    const ca = new Array(12).fill(0);
    for (const f of forecasts) {
      if (f.year === year && (filteredAccountIds.size === 0 || filteredAccountIds.has(f.account_id))) {
        boites[f.month - 1] += f.boites_prevues ?? 0;
        ca[f.month - 1] += f.ca_prevu ?? 0;
      }
    }
    return { boites, ca };
  }, [forecasts, year, filteredAccountIds]);

  const clientsActifs = filteredAccounts.filter((a) => a.status === "actif").length;
  const tauxPenetration = filteredAccounts.length > 0 ? clientsActifs / filteredAccounts.length : 0;
  const caPotentielGlobal = caYear + caPotentielTotal;

  const clientsAlerte = filteredAccounts.filter(
    (a) => a.status === "lost" || a.status === "a_risque" || (a.jours_silence ?? 0) > 90
  );
  const caMoyenParCompteActif = clientsActifs > 0 ? caYear / clientsActifs : 0;

  const tierStats = useMemo(() => {
    const tiers = ["Premium", "Pro", "Pro+"] as const;
    const caField = YEAR_FIELDS[year];
    return tiers.map((tier) => {
      const list = filteredAccounts.filter((a) => a.price_list === tier);
      const ca = list.reduce((s, a) => s + ((a[caField] as number | null) ?? 0), 0);
      const objectif = list.reduce((s, a) => s + (a.objectif_boites ?? 0), 0);
      const potentiel = list.reduce((s, a) => s + ((a.potentiel_boites ?? 0) * 133.66), 0);
      return { tier, count: list.length, ca, objectif, potentiel };
    });
  }, [filteredAccounts, year]);
  const hasTierData = tierStats.some((t) => t.count > 0);

  const caParSegment = useMemo(() => {
    const totals: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const a of filteredAccounts) {
      if (a.segment) totals[a.segment] += (a[YEAR_FIELDS[year]] as number | null) ?? 0;
    }
    return totals;
  }, [filteredAccounts, year]);
  const concentrationSegmentA = caYear > 0 ? caParSegment.A / caYear : 0;

  const withEvolution = useMemo(
    () =>
      filteredAccounts
        .filter((a) => (a.ca_2024 ?? 0) > 0)
        .map((a) => ({ account: a, evolution: ((a.ca_2025 ?? 0) - (a.ca_2024 ?? 0)) / (a.ca_2024 ?? 1) })),
    [filteredAccounts]
  );
  const topCroissance = [...withEvolution].sort((a, b) => b.evolution - a.evolution).slice(0, 5);
  const topDeclin = [...withEvolution].sort((a, b) => a.evolution - b.evolution).slice(0, 5);

  // ── Top 10 / Flop 10 clients : CA 2026 (YTD) vs CA 2025
  const withEvolution2026 = useMemo(
    () =>
      filteredAccounts.map((a) => ({
        account: a,
        ca2026: a.ca_2026_ytd ?? 0,
        ca2025: a.ca_2025 ?? 0,
        evolution: (a.ca_2025 ?? 0) > 0 ? ((a.ca_2026_ytd ?? 0) - (a.ca_2025 ?? 0)) / (a.ca_2025 ?? 1) : null,
      })),
    [filteredAccounts]
  );
  const top10Clients2026 = [...withEvolution2026].sort((a, b) => b.ca2026 - a.ca2026).slice(0, 10);
  const flop10Clients2026 = withEvolution2026
    .filter((r) => r.ca2025 > 0)
    .sort((a, b) => (a.evolution ?? 0) - (b.evolution ?? 0))
    .slice(0, 10);

  const lostAccounts = [...filteredAccounts]
    .filter((a) => a.status === "lost")
    .sort((a, b) => (b.ca_2025 ?? 0) - (a.ca_2025 ?? 0))
    .slice(0, 10);

  const overdueCallAccounts = [...filteredAccounts]
    .filter((a) => a.status === "actif" && (a.days_since_last_call ?? 0) > 60)
    .sort((a, b) => (b.days_since_last_call ?? 0) - (a.days_since_last_call ?? 0))
    .slice(0, 10);


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
      if (m > 12) {
        m = 1;
        y++;
      }
    }

    const existingKeys = new Set(forecasts.map((f) => `${f.account_id}|${f.year}|${f.month}`));
    // Action explicite depuis le dashboard : protégée d'une future
    // régénération automatique du prévisionnel portefeuille.
    const rows = priorityAccounts.flatMap((account) =>
      suggestMonthlyForecast(account, targetMonths)
        .filter((s) => !existingKeys.has(`${account.id}|${s.year}|${s.month}`))
        .map((s) => ({ account_id: account.id, kind: "prevision" as const, source: "manuel" as const, ...s }))
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
  const displayedCaLabel =
    month !== null
      ? `CA réalisé ${MONTH_LABELS[month - 1]} ${year}`
      : ytdPace
      ? `CA réalisé YTD ${year} (à fin ${MONTH_LABELS[ytdPace.cutoffMonth - 1]})`
      : `CA réalisé ${year}`;

  return (
    <div>
      {/* Barre de contrôle / filtres */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-surface px-8 py-3">
        <div className="flex flex-wrap items-center gap-4">
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
              Détail mensuel indisponible
            </span>
          )}
        </div>

        {/* Filtre départemental */}
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-primary" />
          <select
            value={selectedDept ?? ""}
            onChange={(e) => setSelectedDept(e.target.value || null)}
            className="rounded-md border border-border bg-surface px-3 py-1 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Tous les départements ({accounts.length} comptes)</option>
            {Object.entries(DEPT_NAMES).map(([code, name]) => {
              const count = accounts.filter(
                (a) => (a.department_code || (a.postal_code ? a.postal_code.slice(0, 2) : "")) === code
              ).length;
              if (count === 0) return null;
              return (
                <option key={code} value={code}>
                  {code} - {name} ({count})
                </option>
              );
            })}
          </select>
          {selectedDept && (
            <button
              onClick={() => setSelectedDept(null)}
              className="text-xs text-primary underline hover:text-primary-700"
            >
              Effacer
            </button>
          )}
        </div>
      </div>

      <main className="px-8 py-6 space-y-6">
        <p className="text-xs text-muted-foreground">
          {lastImportLabel} · {filteredAccounts.length} comptes analysés
          {selectedDept ? ` dans le département ${selectedDept} (${DEPT_NAMES[selectedDept] ?? ""})` : " sur le secteur AURA"}
        </p>

        {/* Ligne 1 : KPI Majeurs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="CA potentiel à capter"
            value={formatEUR(caPotentielTotal)}
            trend={`Potentiel total secteur : ${formatEUR(caPotentielGlobal)}`}
            icon={Wallet}
          />
          <KpiCard
            label={displayedCaLabel}
            value={formatEUR(displayedCa)}
            trend={
              month === null && ytdPace !== null
                ? `${formatEUR(ytdPace.cur)} vs ${formatEUR(ytdPace.prev)} l'an dernier à fin ${MONTH_LABELS[ytdPace.cutoffMonth - 1]}` +
                  (ytdPace.growth !== null ? ` (${ytdPace.growth > 0 ? "+" : ""}${formatPct(ytdPace.growth)})` : "")
                : undefined
            }
            tone={
              month === null && ytdPace?.growth !== null && ytdPace !== null
                ? ytdPace.growth! >= 0
                  ? "positive"
                  : "negative"
                : "default"
            }
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
              <KpiCard label="Taux de Pénétration" value={formatPct(tauxPenetration)} trend={`${clientsActifs} actifs sur ${filteredAccounts.length}`} icon={Percent} />
              <KpiCard label="Comptes à risque" value={formatNumber(clientsAlerte.length)} tone="negative" icon={AlertTriangle} />
            </>
          )}
        </div>

        {/* Blocs réordonnables : l'utilisateur choisit lui-même leur ordre */}
        <CustomizableLayout
          storageKey="dashboard-block-order-v1"
          blocks={([
            hasMonthlyData && {
              id: "monthly-chart",
              label: "Graphique mensuel",
              node: (
                <InteractiveMonthlyChart
                  year={year}
                  caByMonth={caByMonthOfYear}
                  objectifByMonth={objectifByMonthOfYear}
                  forecastByMonth={forecastByMonthOfYear.ca}
                  selectedMonth={month}
                  onSelectMonth={setMonth}
                />
              ),
            },
            {
              id: "objectif-recurrence",
              label: "Objectif annuel & récurrence des commandes",
              node: (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <AnnualObjectiveCard caByMonth={caByMonthOfYear} objectifByMonth={objectifByMonthOfYear} year={year} />
                  <OrderRecurrenceCard monthlySales={monthlySales} accountIds={filteredAccountIds} />
                </div>
              ),
            },
            {
              id: "competitor-share",
              label: "Sponsoring — Teoxane vs concurrents",
              node: <CompetitorShareCard amounts={competitorAmounts} />,
            },
            {
              id: "department-breakdown",
              label: "Synthèse départementale",
              node: (
                <DepartmentBreakdown
                  accounts={accounts}
                  yearField={YEAR_FIELDS[year]}
                  selectedDept={selectedDept}
                  onSelectDept={setSelectedDept}
                />
              ),
            },
            {
              id: "action-distribution",
              label: "Répartition par action recommandée",
              node: (
                <Card>
                  <CardHeader>
                    <CardTitle>Répartition par action recommandée</CardTitle>
                    <CardDescription>Calculée en direct depuis le score de ciblage — {filteredAccounts.length} comptes</CardDescription>
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
              ),
            },
            {
              id: "secondary-kpis",
              label: "KPIs secondaires",
              node: (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <KpiCard label="CA moyen / compte actif" value={formatEUR(caMoyenParCompteActif)} icon={TrendingUp} />
                  <KpiCard label="Concentration Segment A" value={formatPct(concentrationSegmentA)} icon={Crown} />
                  <KpiCard label="Clients actifs" value={formatNumber(clientsActifs)} icon={Users} />
                  <KpiCard label="Comptes à risque" value={formatNumber(clientsAlerte.length)} tone="negative" icon={AlertTriangle} />
                </div>
              ),
            },
            hasTierData && {
              id: "tier-tracking",
              label: "Suivi Premium / Pro / Pro+",
              node: (
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
              ),
            },
            {
              id: "quick-actions-priority",
              label: "Actions rapides, vue management & comptes prioritaires",
              node: (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="space-y-4 lg:col-span-1">
                    <QuickActionCard accounts={filteredAccounts} />
                    <Card>
                      <CardHeader>
                        <CardTitle>Vue management</CardTitle>
                        <CardDescription>Synthèse du portefeuille</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Comptes suivis</span>
                          <span className="font-medium">{formatNumber(filteredAccounts.length)}</span>
                        </div>
                        {(["A", "B", "C", "D", "E"] as const).map((seg) => (
                          <div key={seg} className="flex justify-between">
                            <span className="text-muted-foreground">Segment {seg}</span>
                            <span className="font-medium">
                              {filteredAccounts.filter((a) => a.segment === seg).length} · {formatEUR(caParSegment[seg])}
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
              ),
            },
            {
              id: "movers",
              label: "Top croissance & déclin",
              node: (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <MoversCard title="Top 5 croissance (Évol. 24→25)" rows={topCroissance} tone="positive" />
                  <MoversCard title="Top 5 déclin (Évol. 24→25)" rows={topDeclin} tone="negative" />
                </div>
              ),
            },
            {
              id: "top-flop-2026",
              label: "Top 10 / Flop 10 clients — CA 2026 vs 2025",
              node: (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <TopFlopClientsCard title="Top 10 clients (CA 2026)" rows={top10Clients2026} tone="positive" />
                  <TopFlopClientsCard title="Flop 10 clients (CA 2026 vs 2025)" rows={flop10Clients2026} tone="negative" />
                </div>
              ),
            },
            {
              id: "lost-overdue",
              label: "Comptes perdus & relances en retard",
              node: (
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
                          {filteredAccounts.some((a) => a.days_since_last_call !== null)
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
              ),
            },
            {
              id: "product-comparison",
              label: "Comparatif ventes produits vs année précédente",
              node: <ProductSalesComparison products={products} filteredAccountIds={filteredAccountIds} />,
            },
          ] as (LayoutBlock | false)[]).filter((b): b is LayoutBlock => !!b)}
        />
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
