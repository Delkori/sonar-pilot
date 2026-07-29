"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { formatEUR, formatNumber, formatPct } from "@/lib/utils";
import { Package, TrendingUp, TrendingDown } from "lucide-react";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";

export interface ProductRow {
  account_id: string;
  brand: string;
  sales_value_ly: number | null;
  sales_value_cy: number | null;
  qty_ordered_ly: number | null;
  qty_ordered_cy: number | null;
  growth_rate_pct: number | null;
}

interface ProductSalesComparisonProps {
  products: ProductRow[];
  filteredAccountIds: Set<string>;
}

export function ProductSalesComparison({
  products,
  filteredAccountIds,
}: ProductSalesComparisonProps) {
  const [metric, setMetric] = useState<"value" | "volume">("value");

  const brandStats = useMemo(() => {
    const totals = new Map<
      string,
      { cy: number; ly: number; qtyCy: number; qtyLy: number }
    >();

    for (const p of products) {
      if (filteredAccountIds.size === 0 || filteredAccountIds.has(p.account_id)) {
        const cur = totals.get(p.brand) ?? { cy: 0, ly: 0, qtyCy: 0, qtyLy: 0 };
        cur.cy += p.sales_value_cy ?? 0;
        cur.ly += p.sales_value_ly ?? 0;
        cur.qtyCy += p.qty_ordered_cy ?? 0;
        cur.qtyLy += p.qty_ordered_ly ?? 0;
        totals.set(p.brand, cur);
      }
    }

    return Array.from(totals.entries())
      .map(([brand, v]) => {
        const diffVal = v.cy - v.ly;
        const growthVal = v.ly > 0 ? diffVal / v.ly : null;

        const diffQty = v.qtyCy - v.qtyLy;
        const growthQty = v.qtyLy > 0 ? diffQty / v.qtyLy : null;

        return {
          brand,
          cyVal: v.cy,
          lyVal: v.ly,
          diffVal,
          growthVal,
          cyQty: v.qtyCy,
          lyQty: v.qtyLy,
          diffQty,
          growthQty,
        };
      })
      .sort((a, b) => b.cyVal - a.cyVal);
  }, [products, filteredAccountIds]);

  type BrandSortKey = "brand" | "lyVal" | "cyVal" | "diffVal" | "growthVal" | "lyQty" | "cyQty" | "growthQty";
  const { sorted: sortedBrandStats, sortKey, dir, toggle } = useSortableTable<(typeof brandStats)[number], BrandSortKey>(
    brandStats,
    {
      brand: (r) => r.brand,
      lyVal: (r) => r.lyVal,
      cyVal: (r) => r.cyVal,
      diffVal: (r) => r.diffVal,
      growthVal: (r) => r.growthVal,
      lyQty: (r) => r.lyQty,
      cyQty: (r) => r.cyQty,
      growthQty: (r) => r.growthQty,
    },
    "cyVal"
  );

  const totalCyVal = useMemo(() => brandStats.reduce((s, b) => s + b.cyVal, 0), [brandStats]);
  const totalLyVal = useMemo(() => brandStats.reduce((s, b) => s + b.lyVal, 0), [brandStats]);
  const totalValGrowth = totalLyVal > 0 ? (totalCyVal - totalLyVal) / totalLyVal : null;

  const totalCyQty = useMemo(() => brandStats.reduce((s, b) => s + b.cyQty, 0), [brandStats]);
  const totalLyQty = useMemo(() => brandStats.reduce((s, b) => s + b.lyQty, 0), [brandStats]);

  const chartData = useMemo(() => {
    return brandStats.map((b) => ({
      name: b.brand,
      "Année en cours": metric === "value" ? b.cyVal : b.cyQty,
      "Année précédente": metric === "value" ? b.lyVal : b.lyQty,
    }));
  }, [brandStats, metric]);

  if (products.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Comparatif Ventes Produits vs Année Précédente</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-6 text-center">
            Importez le fichier Croissance par marque pour activer la comparaison d&apos;une année sur l&apos;autre.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Comparatif Ventes par Marque — Rythme YTD vs N-1</CardTitle>
          <CardDescription>
            Même période (du 1er janvier au dernier mois facturé) comparée à l&apos;an dernier — pas l&apos;année N-1 entière
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          {/* Commutateur Valeur / Volume */}
          <div className="flex rounded-lg border border-border bg-surface-muted p-0.5">
            <button
              onClick={() => setMetric("value")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                metric === "value"
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Valeur (€)
            </button>
            <button
              onClick={() => setMetric("volume")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                metric === "volume"
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Volume (Boîtes)
            </button>
          </div>
          <Package size={18} className="text-primary" />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Synthèse rapide */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-3 bg-surface-muted/30">
            <span className="text-xs text-muted-foreground">Total Ventes ({metric === "value" ? "€" : "Boîtes"})</span>
            <p className="mt-1 text-xl font-bold text-foreground">
              {metric === "value" ? formatEUR(totalCyVal) : `${formatNumber(totalCyQty)} boîtes`}
            </p>
            <p className="text-xs text-muted-foreground">
              vs {metric === "value" ? formatEUR(totalLyVal) : `${formatNumber(totalLyQty)} boîtes`} N-1 (
              <span className={totalValGrowth !== null && totalValGrowth >= 0 ? "text-success font-medium" : "text-danger font-medium"}>
                {totalValGrowth !== null ? `${totalValGrowth > 0 ? "+" : ""}${formatPct(totalValGrowth)}` : "—"}
              </span>
              )
            </p>
          </div>

          <div className="rounded-lg border border-border p-3 bg-surface-muted/30">
            <span className="text-xs text-muted-foreground">Top Marque en CA</span>
            <p className="mt-1 text-xl font-bold text-foreground">
              {brandStats[0]?.brand ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatEUR(brandStats[0]?.cyVal)} ({formatPct(totalCyVal > 0 ? (brandStats[0]?.cyVal ?? 0) / totalCyVal : 0)} du total)
            </p>
          </div>

          <div className="rounded-lg border border-border p-3 bg-surface-muted/30">
            <span className="text-xs text-muted-foreground">Meilleure Croissance</span>
            {(() => {
              const bestGrowth = [...brandStats]
                .filter((b) => b.growthVal !== null)
                .sort((a, b) => (b.growthVal ?? 0) - (a.growthVal ?? 0))[0];
              return (
                <>
                  <p className="mt-1 text-xl font-bold text-success">
                    {bestGrowth ? bestGrowth.brand : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {bestGrowth?.growthVal !== null ? `+${formatPct(bestGrowth?.growthVal)} vs N-1` : "—"}
                  </p>
                </>
              );
            })()}
          </div>
        </div>

        {/* Graphique Recharts comparatif */}
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 10, bottom: 25 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                stroke="#64748B"
                interval={0}
                angle={-15}
                textAnchor="end"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="#64748B"
                tickFormatter={(val) =>
                  metric === "value" ? `${(val / 1000).toFixed(0)}k€` : formatNumber(val)
                }
              />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any) => [
                  metric === "value" ? formatEUR(Number(value)) : `${formatNumber(Number(value))} boîtes`,
                  "",
                ]}
                contentStyle={{
                  backgroundColor: "#FFFFFF",
                  borderColor: "#E2E8F0",
                  borderRadius: "8px",
                  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                }}
              />
              <Legend wrapperStyle={{ paddingTop: "15px", fontSize: "12px" }} />

              <Bar dataKey="Année en cours" fill="#4F46E5" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="Année précédente" fill="#94A3B8" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Tableau détaillé comparatif */}
        <div className="overflow-x-auto border-t border-border pt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <SortableTh label="Marque" sortKey="brand" activeKey={sortKey} dir={dir} onSort={toggle} className="pb-2" />
                <SortableTh label="CA N-1" sortKey="lyVal" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="pb-2" />
                <SortableTh label="CA En cours" sortKey="cyVal" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="pb-2" />
                <SortableTh label="Écart €" sortKey="diffVal" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="pb-2" />
                <SortableTh label="Évol. CA" sortKey="growthVal" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="pb-2" />
                <SortableTh label="Volume N-1" sortKey="lyQty" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="pb-2" />
                <SortableTh label="Volume N" sortKey="cyQty" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="pb-2" />
                <SortableTh label="Évol. Vol." sortKey="growthQty" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {sortedBrandStats.map((b) => (
                <tr key={b.brand} className="border-b border-border last:border-0 hover:bg-surface-muted/50">
                  <td className="py-2.5 font-medium text-foreground">{b.brand}</td>
                  <td className="py-2.5 text-right text-muted-foreground">{formatEUR(b.lyVal)}</td>
                  <td className="py-2.5 text-right font-semibold text-foreground">{formatEUR(b.cyVal)}</td>
                  <td
                    className={`py-2.5 text-right font-medium ${
                      b.diffVal >= 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {b.diffVal > 0 ? "+" : ""}
                    {formatEUR(b.diffVal)}
                  </td>
                  <td className="py-2.5 text-right">
                    {b.growthVal !== null ? (
                      <span
                        className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-semibold ${
                          b.growthVal >= 0
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                        }`}
                      >
                        {b.growthVal >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {b.growthVal > 0 ? "+" : ""}
                        {formatPct(b.growthVal)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2.5 text-right text-muted-foreground">{formatNumber(b.lyQty)}</td>
                  <td className="py-2.5 text-right font-medium text-foreground">{formatNumber(b.cyQty)}</td>
                  <td className="py-2.5 text-right text-xs text-muted-foreground">
                    {b.growthQty !== null ? (
                      <span className={b.growthQty >= 0 ? "text-success" : "text-danger"}>
                        {b.growthQty > 0 ? "+" : ""}
                        {formatPct(b.growthQty)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold text-foreground">
                <td className="py-2.5">Total</td>
                <td className="py-2.5 text-right">{formatEUR(totalLyVal)}</td>
                <td className="py-2.5 text-right">{formatEUR(totalCyVal)}</td>
                <td className={`py-2.5 text-right ${totalCyVal - totalLyVal >= 0 ? "text-success" : "text-danger"}`}>
                  {totalCyVal - totalLyVal > 0 ? "+" : ""}
                  {formatEUR(totalCyVal - totalLyVal)}
                </td>
                <td className="py-2.5 text-right">
                  {totalValGrowth !== null ? (
                    <span className={totalValGrowth >= 0 ? "text-success" : "text-danger"}>
                      {totalValGrowth > 0 ? "+" : ""}
                      {formatPct(totalValGrowth)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2.5 text-right">{formatNumber(totalLyQty)}</td>
                <td className="py-2.5 text-right">{formatNumber(totalCyQty)}</td>
                <td className="py-2.5 text-right text-xs">
                  {totalLyQty > 0 ? (
                    <span className={totalCyQty - totalLyQty >= 0 ? "text-success" : "text-danger"}>
                      {totalCyQty - totalLyQty > 0 ? "+" : ""}
                      {formatPct((totalCyQty - totalLyQty) / totalLyQty)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
