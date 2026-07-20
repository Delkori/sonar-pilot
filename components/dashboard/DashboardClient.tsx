"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { PriorityAccountsTable } from "@/components/dashboard/PriorityAccountsTable";
import { formatEUR, formatNumber, formatPct } from "@/lib/utils";
import { Target, TrendingDown, TrendingUp, Users, AlertTriangle, Crown, PhoneMissed, UserX, Package } from "lucide-react";
import type { Account } from "@/types/database";
import Link from "next/link";

const YEAR_FIELDS: Record<number, keyof Account> = {
  2022: "ca_2022",
  2023: "ca_2023",
  2024: "ca_2024",
  2025: "ca_2025",
  2026: "ca_2026_ytd",
};
const YEARS = [2022, 2023, 2024, 2025, 2026];
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

export function DashboardClient({
  accounts,
  monthlySales,
  products,
  lastImportLabel,
}: {
  accounts: Account[];
  monthlySales: MonthlySale[];
  products: ProductRow[];
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

  const objectifTotal = accounts.reduce((sum, a) => sum + (a.objectif_boites ?? 0), 0);
  const realiseTotal = accounts.reduce((sum, a) => sum + (a.realise_boites ?? 0), 0);
  const ecartTotal = realiseTotal - objectifTotal;
  const atteinte = objectifTotal > 0 ? realiseTotal / objectifTotal : 0;

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

  const clientsActifs = accounts.filter((a) => a.status === "actif").length;
  const clientsAlerte = accounts.filter(
    (a) => a.status === "lost" || a.status === "a_risque" || (a.jours_silence ?? 0) > 90
  );
  const caMoyenParCompteActif = clientsActifs > 0 ? caYear / clientsActifs : 0;

  const caParSegment = useMemo(() => {
    const totals: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const a of accounts) {
      if (a.segment) totals[a.segment] += (a[YEAR_FIELDS[year]] as number | null) ?? 0;
    }
    return totals;
  }, [accounts, year]);
  const concentrationSegmentA = caYear > 0 ? caParSegment.A / caYear : 0;

  const topCroissance = [...accounts]
    .filter((a) => a.evolution_pct !== null)
    .sort((a, b) => (b.evolution_pct ?? 0) - (a.evolution_pct ?? 0))
    .slice(0, 5);
  const topDeclin = [...accounts]
    .filter((a) => a.evolution_pct !== null)
    .sort((a, b) => (a.evolution_pct ?? 0) - (b.evolution_pct ?? 0))
    .slice(0, 5);

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

  const priorityAccounts = [...accounts]
    .sort((a, b) => {
      const ecartA = (a.realise_boites ?? 0) - (a.objectif_boites ?? 0);
      const ecartB = (b.realise_boites ?? 0) - (b.objectif_boites ?? 0);
      return ecartA - ecartB;
    })
    .slice(0, 8);

  const displayedCa = month !== null ? caMonth : caYear;
  const displayedCaLabel = month !== null ? `CA ${MONTH_LABELS[month - 1]} ${year}` : `CA ${year}`;

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
            Détail mensuel indisponible — importez le fichier ventes mensuelles pour l&apos;activer
          </span>
        )}
      </div>

      <main className="px-8 py-6 space-y-6">
        <p className="text-xs text-muted-foreground">{lastImportLabel}</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Objectif Q3 (boîtes)" value={formatNumber(objectifTotal)} icon={Target} />
          <KpiCard
            label="Réalisé (boîtes)"
            value={formatNumber(realiseTotal)}
            trend={`${formatPct(atteinte)} de l'objectif`}
            tone={atteinte >= 1 ? "positive" : "default"}
            icon={TrendingDown}
          />
          <KpiCard
            label="Écart"
            value={`${ecartTotal > 0 ? "+" : ""}${formatNumber(ecartTotal)}`}
            tone={ecartTotal < 0 ? "negative" : "positive"}
            icon={AlertTriangle}
          />
          <KpiCard
            label={displayedCaLabel}
            value={formatEUR(displayedCa)}
            trend={month === null && caYoyGrowth !== null ? `${caYoyGrowth > 0 ? "+" : ""}${formatPct(caYoyGrowth)} vs ${year - 1}` : undefined}
            tone={month === null && caYoyGrowth !== null ? (caYoyGrowth >= 0 ? "positive" : "negative") : "default"}
            icon={Users}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="CA moyen / compte actif" value={formatEUR(caMoyenParCompteActif)} icon={TrendingUp} />
          <KpiCard label="Concentration Segment A" value={formatPct(concentrationSegmentA)} icon={Crown} />
          <KpiCard label="Comptes à risque" value={formatNumber(clientsAlerte.length)} tone="negative" icon={AlertTriangle} />
          <KpiCard label="Clients actifs" value={formatNumber(clientsActifs)} icon={Users} />
        </div>

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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
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

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Comptes prioritaires</CardTitle>
              <CardDescription>Écart le plus critique entre objectif et réalisé</CardDescription>
            </CardHeader>
            <PriorityAccountsTable accounts={priorityAccounts} />
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MoversCard title="Top 5 croissance (Évol. 25→26)" accounts={topCroissance} tone="positive" />
          <MoversCard title="Top 5 déclin (Évol. 25→26)" accounts={topDeclin} tone="negative" />
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

function MoversCard({ title, accounts, tone }: { title: string; accounts: Account[]; tone: "positive" | "negative" }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {accounts.length === 0 && <p className="text-sm text-muted-foreground">Pas assez de données.</p>}
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between text-sm">
            <Link href={`/comptes/${a.id}`} className="text-foreground hover:text-primary">
              {a.name}
            </Link>
            <span className={tone === "positive" ? "text-success" : "text-danger"}>{formatPct(a.evolution_pct)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
