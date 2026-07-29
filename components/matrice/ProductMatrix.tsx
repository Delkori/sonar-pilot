"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SegmentBadge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR, formatNumber } from "@/lib/utils";
import { computeTargetingScore } from "@/lib/scoring";
import { AlertTriangle, Package, TrendingDown, HelpCircle } from "lucide-react";
import type { Account, Segment } from "@/types/database";

interface ProductRow {
  account_id: string;
  brand: string;
  qty_ordered_cy: number | null;
  sales_value_cy: number | null;
  qty_ordered_ly: number | null;
  sales_value_ly: number | null;
}

type SortKey = "name" | "segment" | "score" | "missing" | "ca_nc" | "boites" | "retard";

export function ProductMatrix({ accounts, products }: { accounts: Account[]; products: ProductRow[] }) {
  const [segment, setSegment] = useState<Segment | "all">("all");
  const [search, setSearch] = useState("");
  const [minBoites, setMinBoites] = useState("");
  const [minCa, setMinCa] = useState("");
  const [onlyRetard, setOnlyRetard] = useState(false);

  const brands = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of products) {
      totals.set(p.brand, (totals.get(p.brand) ?? 0) + (p.sales_value_cy ?? 0));
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([brand]) => brand);
  }, [products]);

  const productsByAccount = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const p of products) {
      if (!map.has(p.account_id)) map.set(p.account_id, new Map());
      map.get(p.account_id)!.set(p.brand, p.qty_ordered_cy ?? 0);
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

  // ── Par compte : boîtes totales (toutes marques) et "retard cumulé" —
  // somme, marque par marque, des boîtes en dessous du rythme de l'an
  // dernier (qty_ordered_ly - qty_ordered_cy quand positif). Donnée réelle
  // (pas une estimation), calculée à partir du même import de factures que
  // le reste de l'app.
  const perAccountStats = useMemo(() => {
    const map = new Map<string, { boites: number; retard: number }>();
    for (const p of products) {
      const cur = map.get(p.account_id) ?? { boites: 0, retard: 0 };
      cur.boites += p.qty_ordered_cy ?? 0;
      cur.retard += Math.max((p.qty_ordered_ly ?? 0) - (p.qty_ordered_cy ?? 0), 0);
      map.set(p.account_id, cur);
    }
    return map;
  }, [products]);

  // ── Dashboard récap : par référence, CA non capté cumulé chez les comptes
  // qui ne l'achètent pas — pour savoir sur quelle marque insister.
  const brandOpportunity = useMemo(() => {
    const boughtByBrand = new Map<string, Set<string>>();
    for (const p of products) {
      if ((p.qty_ordered_cy ?? 0) > 0) {
        const set = boughtByBrand.get(p.brand) ?? new Set<string>();
        set.add(p.account_id);
        boughtByBrand.set(p.brand, set);
      }
    }
    return brands
      .map((brand) => {
        const boughtSet = boughtByBrand.get(brand) ?? new Set<string>();
        const missingAccounts = accounts.filter((a) => !boughtSet.has(a.id));
        const potentielManque = missingAccounts.reduce(
          (s, a) => s + Math.max((a.potentiel_boites ?? 0) * avgPricePerBox - (a.ca_2026_ytd ?? 0), 0),
          0
        );
        return { brand, missingCount: missingAccounts.length, potentielManque };
      })
      .sort((a, b) => b.potentielManque - a.potentielManque);
  }, [brands, products, accounts, avgPricePerBox]);

  // ── Médecins en baisse de consommation : retard cumulé le plus élevé
  const decliningAccounts = useMemo(() => {
    return accounts
      .map((a) => ({ account: a, stats: perAccountStats.get(a.id) }))
      .filter((r) => (r.stats?.retard ?? 0) > 0)
      .sort((a, b) => (b.stats?.retard ?? 0) - (a.stats?.retard ?? 0))
      .slice(0, 8);
  }, [accounts, perAccountStats]);

  // ── Comptes sans aucune donnée produit — chiffre manquant à récupérer
  const accountsWithoutData = useMemo(
    () => accounts.filter((a) => !perAccountStats.has(a.id)),
    [accounts, perAccountStats]
  );

  const filteredRows = useMemo(() => {
    const min = minBoites ? Number(minBoites) : null;
    const minCaNum = minCa ? Number(minCa) : null;
    return accounts
      .filter((a) => (segment === "all" ? true : a.segment === segment))
      .filter((a) => (search ? a.name.toLowerCase().includes(search.toLowerCase()) : true))
      .map((a) => {
        const bought = productsByAccount.get(a.id) ?? new Map();
        const missing = brands.filter((b) => !bought.has(b) || bought.get(b) === 0).length;
        const caNonCapte = Math.max((a.potentiel_boites ?? 0) * avgPricePerBox - (a.ca_2026_ytd ?? 0), 0);
        const score = computeTargetingScore(a).total;
        const stats = perAccountStats.get(a.id) ?? { boites: 0, retard: 0 };
        return { account: a, bought, missing, caNonCapte, score, boites: stats.boites, retard: stats.retard };
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
      {/* ── Dashboard récap : où regarder en priorité ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Package size={13} className="text-primary" /> Référence à prioriser
          </p>
          <p className="mt-1 text-base font-bold text-foreground">{brandOpportunity[0]?.brand ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            {brandOpportunity[0] ? `${formatEUR(brandOpportunity[0].potentielManque)} manqué sur ${brandOpportunity[0].missingCount} compte(s)` : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <TrendingDown size={13} className="text-danger" /> Médecin en plus forte baisse
          </p>
          <p className="mt-1 text-base font-bold text-foreground">{decliningAccounts[0]?.account.name ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            {decliningAccounts[0] ? `${formatNumber(decliningAccounts[0].stats?.retard ?? 0)} boîtes de retard sur son rythme N-1` : "Aucune baisse détectée"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <AlertTriangle size={13} className="text-warning" /> Retard cumulé total
          </p>
          <p className="mt-1 text-base font-bold text-foreground">
            {formatNumber(decliningAccounts.reduce((s, r) => s + (r.stats?.retard ?? 0), 0))} boîtes
          </p>
          <p className="text-xs text-muted-foreground">Sur {decliningAccounts.length} compte(s) en dessous du rythme N-1</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <HelpCircle size={13} className="text-muted-foreground" /> Chiffre à récupérer
          </p>
          <p className="mt-1 text-base font-bold text-foreground">{formatNumber(accountsWithoutData.length)} compte(s)</p>
          <p className="text-xs text-muted-foreground">Sans aucune donnée produit — à demander/réimporter</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Médecins en baisse de consommation</p>
        {decliningAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun compte en retard sur son rythme de l&apos;an dernier.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {decliningAccounts.map(({ account, stats }) => (
              <Link
                key={account.id}
                href={`/comptes/${account.id}`}
                className="flex items-center gap-1.5 rounded-full border border-danger/20 bg-danger/5 px-2.5 py-1 text-xs text-danger hover:bg-danger/10"
              >
                {account.name}
                <span className="font-semibold">−{formatNumber(stats?.retard ?? 0)}</span>
              </Link>
            ))}
          </div>
        )}
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
          <span className="ml-auto text-xs text-muted-foreground">{rows.length} compte(s) · {brands.length} marques</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <SortableTh label="Compte" sortKey="name" activeKey={sortKey} dir={dir} onSort={toggle} className="sticky left-0 z-10 bg-surface px-4" />
                <SortableTh label="Seg" sortKey="segment" activeKey={sortKey} dir={dir} onSort={toggle} className="px-2" />
                {brands.map((b) => (
                  <th key={b} className="px-2 py-2 text-center font-medium whitespace-nowrap">{b}</th>
                ))}
                <SortableTh label="Boîtes" sortKey="boites" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
                <SortableTh label="Retard" sortKey="retard" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
                <SortableTh label="Réfs manq." sortKey="missing" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
                <SortableTh label="CA non capté" sortKey="ca_nc" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ account, bought, missing, caNonCapte, score, boites, retard }) => (
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
                    const qty = bought.get(b) ?? 0;
                    return (
                      <td key={b} className={`px-2 py-2 text-center ${qty > 0 ? "bg-primary-50" : ""}`}>
                        {qty > 0 ? (
                          <span className="font-medium text-primary-700">{qty}</span>
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
                  <td className="px-3 py-2 text-right font-medium text-foreground">{missing}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{formatEUR(caNonCapte)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-border bg-surface-muted px-5 py-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-primary-50" /> Acheté (quantité)</span>
          <span className="flex items-center gap-1.5"><span className="text-danger">✕</span> Non acheté — opportunité cross-sell</span>
          <span>Retard = boîtes en dessous du rythme N-1, cumulé sur toutes les marques</span>
          <span className="ml-auto">CA non capté = potentiel (boîtes) × prix moyen/boîte du portefeuille ({formatEUR(avgPricePerBox)}) − CA 2026 YTD</span>
        </div>
      </div>
    </div>
  );
}
