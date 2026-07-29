"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SegmentBadge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR, formatNumber } from "@/lib/utils";
import { computeTargetingScore } from "@/lib/scoring";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { Account, Segment } from "@/types/database";

interface ProductRow {
  account_id: string;
  brand: string;
  qty_ordered_cy: number | null;
  sales_value_cy: number | null;
  qty_ordered_ly: number | null;
  sales_value_ly: number | null;
}

type SortKey = "name" | "segment" | "score" | "missing" | "ca_nc" | "boites" | "retard" | "croissance";

// Références retirées du catalogue — un "retard" sur ces marques ne reflète
// pas une baisse de consommation réelle, juste l'arrêt du produit. Exclues
// du calcul de retard et du classement des références à prioriser.
const DISCONTINUED_BRANDS = new Set(["Global Action", "Ultimate", "Kiss"]);

export function ProductMatrix({ accounts, products }: { accounts: Account[]; products: ProductRow[] }) {
  const [segment, setSegment] = useState<Segment | "all">("all");
  const [search, setSearch] = useState("");
  const [minBoites, setMinBoites] = useState("");
  const [minCa, setMinCa] = useState("");
  const [onlyRetard, setOnlyRetard] = useState(false);
  const [cellMetric, setCellMetric] = useState<"boites" | "ca">("boites");

  const brands = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of products) {
      totals.set(p.brand, (totals.get(p.brand) ?? 0) + (p.sales_value_cy ?? 0));
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([brand]) => brand);
  }, [products]);

  // Par compte × marque : quantité et CA, année en cours et N-1 (même
  // fenêtre YTD des deux côtés) — sert au tableau détaillé (bascule
  // boîtes/CA) et au calcul du retard par référence.
  const productsByAccount = useMemo(() => {
    const map = new Map<string, Map<string, { qtyCy: number; qtyLy: number; caCy: number; caLy: number }>>();
    for (const p of products) {
      if (!map.has(p.account_id)) map.set(p.account_id, new Map());
      map.get(p.account_id)!.set(p.brand, {
        qtyCy: p.qty_ordered_cy ?? 0,
        qtyLy: p.qty_ordered_ly ?? 0,
        caCy: p.sales_value_cy ?? 0,
        caLy: p.sales_value_ly ?? 0,
      });
    }
    return map;
  }, [products]);

  // prix moyen par boîte observé sur le portefeuille — sert à estimer le CA
  // non capté (potentiel déclaré non converti en CA), pas une donnée inventée
  const avgPricePerBox = useMemo(() => {
    let totalCa = 0;
    let totalBoites = 0;
    for (const a of accounts) {
      if (a.realise_boites && a.realise_boites > 0 && a.ca_2026_ytd) {
        totalCa += a.ca_2026_ytd;
        totalBoites += a.realise_boites;
      }
    }
    return totalBoites > 0 ? totalCa / totalBoites : 0;
  }, [accounts]);

  // ── Par compte : boîtes totales (toutes marques), "retard cumulé" (boîtes
  // en dessous du rythme N-1) et "croissance cumulée" (boîtes au-dessus du
  // rythme N-1) — sommées marque par marque. Données réelles (pas une
  // estimation), calculées à partir du même import de factures que le reste
  // de l'app. Les deux excluent les références retirées du catalogue.
  const perAccountStats = useMemo(() => {
    const map = new Map<string, { boites: number; retard: number; croissance: number }>();
    for (const p of products) {
      const cur = map.get(p.account_id) ?? { boites: 0, retard: 0, croissance: 0 };
      cur.boites += p.qty_ordered_cy ?? 0;
      if (!DISCONTINUED_BRANDS.has(p.brand)) {
        cur.retard += Math.max((p.qty_ordered_ly ?? 0) - (p.qty_ordered_cy ?? 0), 0);
        cur.croissance += Math.max((p.qty_ordered_cy ?? 0) - (p.qty_ordered_ly ?? 0), 0);
      }
      map.set(p.account_id, cur);
    }
    return map;
  }, [products]);

  // ── Top 10 clients (boîtes cette année) / Flop 10 (retard cumulé le plus
  // élevé vs le rythme N-1, hors références retirées du catalogue).
  const top10Boites = useMemo(() => {
    return accounts
      .map((a) => ({ account: a, stats: perAccountStats.get(a.id) }))
      .filter((r) => (r.stats?.boites ?? 0) > 0)
      .sort((a, b) => (b.stats?.boites ?? 0) - (a.stats?.boites ?? 0))
      .slice(0, 10);
  }, [accounts, perAccountStats]);

  const flop10Retard = useMemo(() => {
    return accounts
      .map((a) => ({ account: a, stats: perAccountStats.get(a.id) }))
      .filter((r) => (r.stats?.retard ?? 0) > 0)
      .sort((a, b) => (b.stats?.retard ?? 0) - (a.stats?.retard ?? 0))
      .slice(0, 10);
  }, [accounts, perAccountStats]);

  // ── Top 10 clients en croissance vs N-1 (boîtes cumulées au-dessus du
  // rythme de l'an dernier, hors références retirées du catalogue).
  const top10Croissance = useMemo(() => {
    return accounts
      .map((a) => ({ account: a, stats: perAccountStats.get(a.id) }))
      .filter((r) => (r.stats?.croissance ?? 0) > 0)
      .sort((a, b) => (b.stats?.croissance ?? 0) - (a.stats?.croissance ?? 0))
      .slice(0, 10);
  }, [accounts, perAccountStats]);

  const filteredRows = useMemo(() => {
    const min = minBoites ? Number(minBoites) : null;
    const minCaNum = minCa ? Number(minCa) : null;
    return accounts
      .filter((a) => (segment === "all" ? true : a.segment === segment))
      .filter((a) => (search ? a.name.toLowerCase().includes(search.toLowerCase()) : true))
      .map((a) => {
        const bought = productsByAccount.get(a.id) ?? new Map();
        const missing = brands.filter((b) => !bought.has(b) || (bought.get(b)?.qtyCy ?? 0) === 0).length;
        const caNonCapte = Math.max((a.potentiel_boites ?? 0) * avgPricePerBox - (a.ca_2026_ytd ?? 0), 0);
        const score = computeTargetingScore(a).total;
        const stats = perAccountStats.get(a.id) ?? { boites: 0, retard: 0, croissance: 0 };
        return { account: a, bought, missing, caNonCapte, score, boites: stats.boites, retard: stats.retard, croissance: stats.croissance };
      })
      .filter((r) => (min !== null ? r.boites >= min : true))
      .filter((r) => (minCaNum !== null ? (r.account.ca_2026_ytd ?? 0) >= minCaNum : true))
      .filter((r) => (onlyRetard ? r.retard > 0 : true));
  }, [accounts, productsByAccount, brands, segment, search, avgPricePerBox, perAccountStats, minBoites, minCa, onlyRetard]);

  const { sorted: rows, sortKey, dir, toggle } = useSortableTable<(typeof filteredRows)[number], SortKey>(
    filteredRows,
    {
      name: (r) => r.account.name,
      segment: (r) => r.account.segment,
      score: (r) => r.score,
      missing: (r) => r.missing,
      ca_nc: (r) => r.caNonCapte,
      boites: (r) => r.boites,
      retard: (r) => r.retard,
      croissance: (r) => r.croissance,
    },
    "missing"
  );

  if (brands.length === 0) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Aucune donnée produit importée — chargez le fichier &quot;Customer Growth By Brand&quot; depuis l&apos;écran Import pour activer cette matrice.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Top 10 / Flop 10 clients — boîtes cette année (YTD) ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <TrendingUp size={13} className="text-success" /> Top 10 clients en croissance (YTD vs N-1)
          </p>
          {top10Croissance.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun compte en croissance sur son rythme de l&apos;an dernier.</p>
          ) : (
            <div className="space-y-1.5">
              {top10Croissance.map(({ account, stats }, idx) => (
                <div key={account.id} className="flex items-center justify-between text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 text-xs text-muted-foreground">{idx + 1}.</span>
                    <Link href={`/comptes/${account.id}`} className="truncate text-foreground hover:text-primary">
                      {account.name}
                    </Link>
                  </div>
                  <span className="shrink-0 font-medium text-success">+{formatNumber(stats?.croissance ?? 0)} boîtes</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Hors références retirées du catalogue (Global Action, Ultimate, Kiss).
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <TrendingUp size={13} className="text-success" /> Top 10 clients (boîtes YTD)
          </p>
          {top10Boites.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune donnée.</p>
          ) : (
            <div className="space-y-1.5">
              {top10Boites.map(({ account, stats }, idx) => (
                <div key={account.id} className="flex items-center justify-between text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 text-xs text-muted-foreground">{idx + 1}.</span>
                    <Link href={`/comptes/${account.id}`} className="truncate text-foreground hover:text-primary">
                      {account.name}
                    </Link>
                  </div>
                  <span className="shrink-0 font-medium text-foreground">{formatNumber(stats?.boites ?? 0)} boîtes</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <TrendingDown size={13} className="text-danger" /> Flop 10 clients (retard YTD vs N-1)
          </p>
          {flop10Retard.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun compte en retard sur son rythme de l&apos;an dernier.</p>
          ) : (
            <div className="space-y-1.5">
              {flop10Retard.map(({ account, stats }, idx) => (
                <div key={account.id} className="flex items-center justify-between text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 text-xs text-muted-foreground">{idx + 1}.</span>
                    <Link href={`/comptes/${account.id}`} className="truncate text-foreground hover:text-primary">
                      {account.name}
                    </Link>
                  </div>
                  <span className="shrink-0 font-medium text-danger">−{formatNumber(stats?.retard ?? 0)} boîtes</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Hors références retirées du catalogue (Global Action, Ultimate, Kiss).
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-muted px-5 py-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un compte..."
            className="min-w-56 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value as Segment | "all")}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          >
            <option value="all">Tous segments</option>
            {(["A", "B", "C", "D", "E"] as const).map((s) => (
              <option key={s} value={s}>Segment {s}</option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            value={minBoites}
            onChange={(e) => setMinBoites(e.target.value)}
            placeholder="Min boîtes"
            className="w-28 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
          <input
            type="number"
            min={0}
            value={minCa}
            onChange={(e) => setMinCa(e.target.value)}
            placeholder="Min CA (€)"
            className="w-28 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
          <label className="flex items-center gap-1.5 text-sm text-foreground">
            <input type="checkbox" checked={onlyRetard} onChange={(e) => setOnlyRetard(e.target.checked)} className="accent-primary" />
            En retard uniquement
          </label>
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            <button
              onClick={() => setCellMetric("boites")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                cellMetric === "boites" ? "bg-primary-100 text-primary-700" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Boîtes
            </button>
            <button
              onClick={() => setCellMetric("ca")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                cellMetric === "ca" ? "bg-primary-100 text-primary-700" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              CA
            </button>
          </div>
          <span className="ml-auto text-xs text-muted-foreground">{rows.length} compte(s) · {brands.length} marques</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <SortableTh label="Compte" sortKey="name" activeKey={sortKey} dir={dir} onSort={toggle} className="sticky left-0 z-10 bg-surface px-4" />
                <SortableTh label="Seg" sortKey="segment" activeKey={sortKey} dir={dir} onSort={toggle} className="px-2" />
                {brands.map((b) => (
                  <th key={b} className="px-2 py-2 text-center font-medium whitespace-nowrap">
                    {b}
                    <span className="ml-1 font-normal text-muted-foreground/70">
                      ({cellMetric === "boites" ? "boîtes" : "CA"})
                    </span>
                  </th>
                ))}
                <SortableTh label="Boîtes (YTD)" sortKey="boites" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
                <SortableTh label="Retard" sortKey="retard" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
                <SortableTh label="Croissance" sortKey="croissance" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
                <SortableTh label="Réfs manq." sortKey="missing" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
                <SortableTh label="CA non capté" sortKey="ca_nc" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ account, bought, missing, caNonCapte, score, boites, retard, croissance }) => (
                <tr key={account.id} className="border-b border-border last:border-0 hover:bg-surface-muted">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Link href={`/comptes/${account.id}`} className="font-medium text-foreground hover:text-primary">
                        {account.name}
                      </Link>
                      <ScoreBadge score={score} />
                    </div>
                  </td>
                  <td className="px-2 py-2"><SegmentBadge segment={account.segment} /></td>
                  {brands.map((b) => {
                    const cell = bought.get(b);
                    const cy = cellMetric === "boites" ? cell?.qtyCy ?? 0 : cell?.caCy ?? 0;
                    const ly = cellMetric === "boites" ? cell?.qtyLy ?? 0 : cell?.caLy ?? 0;
                    const isDiscontinued = DISCONTINUED_BRANDS.has(b);
                    const retardCell = !isDiscontinued && ly > cy ? ly - cy : 0;
                    const croissanceCell = !isDiscontinued && cy > ly ? cy - ly : 0;
                    return (
                      <td key={b} className={`px-2 py-2 text-center ${cy > 0 ? "bg-primary-50" : ""}`}>
                        {cy > 0 ? (
                          <div className="leading-tight">
                            <span className="font-medium text-primary-700">
                              {cellMetric === "boites" ? formatNumber(cy) : formatEUR(cy)}
                            </span>
                            {retardCell > 0 && (
                              <div className="text-[10px] font-medium text-danger">
                                −{cellMetric === "boites" ? formatNumber(retardCell) : formatEUR(retardCell)} vs 2025
                              </div>
                            )}
                            {croissanceCell > 0 && (
                              <div className="text-[10px] font-medium text-success">
                                +{cellMetric === "boites" ? formatNumber(croissanceCell) : formatEUR(croissanceCell)} vs 2025
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-danger">✕</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-medium text-foreground">{formatNumber(boites)}</td>
                  <td className="px-3 py-2 text-right">
                    {retard > 0 ? <span className="font-medium text-danger">−{formatNumber(retard)}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {croissance > 0 ? <span className="font-medium text-success">+{formatNumber(croissance)}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-foreground">{missing}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{formatEUR(caNonCapte)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-border bg-surface-muted px-5 py-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-primary-50" /> Acheté (bascule boîtes/CA ci-dessus)</span>
          <span className="flex items-center gap-1.5"><span className="text-danger">✕</span> Non acheté — opportunité cross-sell</span>
          <span className="text-danger">−N vs 2025</span> = en retard sur cette référence · <span className="text-success">+N vs 2025</span> = en croissance
          <span>· Retard/Croissance (colonnes) = cumulé sur toutes les marques</span>
          <span className="ml-auto">CA non capté = potentiel (boîtes) × prix moyen/boîte du portefeuille ({formatEUR(avgPricePerBox)}) − CA 2026 YTD</span>
        </div>
      </div>
    </div>
  );
}
