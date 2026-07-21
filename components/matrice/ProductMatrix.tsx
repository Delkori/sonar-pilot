"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SegmentBadge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR } from "@/lib/utils";
import { computeTargetingScore } from "@/lib/scoring";
import type { Account, Segment } from "@/types/database";

interface ProductRow {
  account_id: string;
  brand: string;
  qty_ordered_cy: number | null;
  sales_value_cy: number | null;
}

type SortKey = "name" | "segment" | "score" | "missing" | "ca_nc";

export function ProductMatrix({ accounts, products }: { accounts: Account[]; products: ProductRow[] }) {
  const [segment, setSegment] = useState<Segment | "all">("all");
  const [search, setSearch] = useState("");

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

  const filteredRows = useMemo(() => {
    return accounts
      .filter((a) => (segment === "all" ? true : a.segment === segment))
      .filter((a) => (search ? a.name.toLowerCase().includes(search.toLowerCase()) : true))
      .map((a) => {
        const bought = productsByAccount.get(a.id) ?? new Map();
        const missing = brands.filter((b) => !bought.has(b) || bought.get(b) === 0).length;
        const caNonCapte = Math.max((a.potentiel_boites ?? 0) * avgPricePerBox - (a.ca_2026_ytd ?? 0), 0);
        const score = computeTargetingScore(a).total;
        return { account: a, bought, missing, caNonCapte, score };
      });
  }, [accounts, productsByAccount, brands, segment, search, avgPricePerBox]);

  const { sorted: rows, sortKey, dir, toggle } = useSortableTable<(typeof filteredRows)[number], SortKey>(
    filteredRows,
    {
      name: (r) => r.account.name,
      segment: (r) => r.account.segment,
      score: (r) => r.score,
      missing: (r) => r.missing,
      ca_nc: (r) => r.caNonCapte,
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
    <div>
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
              <SortableTh label="Réfs manq." sortKey="missing" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
              <SortableTh label="CA non capté" sortKey="ca_nc" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ account, bought, missing, caNonCapte, score }) => (
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
                <td className="px-3 py-2 text-right font-medium text-foreground">{missing}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{formatEUR(caNonCapte)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 border-t border-border bg-surface-muted px-5 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-primary-50" /> Acheté (quantité)</span>
        <span className="flex items-center gap-1.5"><span className="text-danger">✕</span> Non acheté — opportunité cross-sell</span>
        <span className="ml-auto">CA non capté = potentiel (boîtes) × prix moyen/boîte du portefeuille ({formatEUR(avgPricePerBox)}) − CA 2026 YTD</span>
      </div>
    </div>
  );
}
