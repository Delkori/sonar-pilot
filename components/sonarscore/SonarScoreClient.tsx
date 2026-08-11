"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { SegmentBadge } from "@/components/ui/Badge";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatNumber } from "@/lib/utils";
import { computeBrandVelocities, computeProductAlerts, type PurchaseLine } from "@/lib/sonarscore/velocity";
import { computeRfmsScores, assignSonarTiers, TIER_META, type SonarTier } from "@/lib/sonarscore/rfms";
import { buildContractMatrix, QUADRANT_META, type MatrixQuadrant } from "@/lib/sonarscore/contractMatrix";
import { predictNextOrders, forecastForPeriod } from "@/lib/sonarscore/prediction";
import type { Account, AccountProductPurchase } from "@/types/database";
import { TrendingUp, AlertTriangle, FlaskConical, Target } from "lucide-react";

type AccountSlim = Pick<Account, "id" | "name" | "segment" | "city" | "price_list" | "objectif_boites" | "realise_boites">;
type PurchaseSlim = Pick<AccountProductPurchase, "account_id" | "brand" | "purchase_date" | "qty" | "value_eur">;

type SortKey = "name" | "segment" | "score" | "tier" | "quadrant" | "avancement" | "retard" | "prochaine" | "q3";

const TIER_COLOR: Record<SonarTier, string> = {
  tier_1: "#16a34a",
  tier_2: "#4f46e5",
  tier_3: "#d97706",
  tier_4: "#94a3b8",
};

// Q3 2026 — fenêtre de test explicite (à ajuster si le calendrier de
// validation change).
const Q3_START = "2026-07-01";
const Q3_END = "2026-09-30";

export function SonarScoreClient({ accounts, purchases }: { accounts: AccountSlim[]; purchases: PurchaseSlim[] }) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<SonarTier | "all">("all");
  const [quadrantFilter, setQuadrantFilter] = useState<MatrixQuadrant | "all">("all");

  const purchaseLines: (PurchaseLine & { value_eur: number })[] = useMemo(
    () =>
      purchases.map((p) => ({
        account_id: p.account_id,
        brand: p.brand,
        purchase_date: p.purchase_date,
        qty: Number(p.qty),
        value_eur: Number(p.value_eur),
      })),
    [purchases]
  );

  const brandVelocities = useMemo(() => computeBrandVelocities(purchaseLines), [purchaseLines]);
  const alerts = useMemo(() => computeProductAlerts(purchaseLines, brandVelocities), [purchaseLines, brandVelocities]);
  const rfmsResults = useMemo(() => computeRfmsScores(purchaseLines), [purchaseLines]);
  const tiers = useMemo(() => assignSonarTiers(rfmsResults), [rfmsResults]);
  const rfmsByAccount = useMemo(() => new Map(rfmsResults.map((r) => [r.accountId, r])), [rfmsResults]);

  const contractMatrix = useMemo(
    () =>
      buildContractMatrix(
        accounts.map((a) => ({
          id: a.id,
          price_list: a.price_list,
          objectif_boites: a.objectif_boites,
          realise_boites: a.realise_boites,
        })),
        tiers
      ),
    [accounts, tiers]
  );
  const matrixByAccount = useMemo(() => new Map(contractMatrix.map((m) => [m.accountId, m])), [contractMatrix]);

  const predictions = useMemo(() => predictNextOrders(purchaseLines, brandVelocities), [purchaseLines, brandVelocities]);
  const q3Forecast = useMemo(() => forecastForPeriod(predictions, Q3_START, Q3_END), [predictions]);
  const q3ByAccount = useMemo(() => new Map(q3Forecast.map((f) => [f.accountId, f])), [q3Forecast]);

  const alertsByAccount = useMemo(() => {
    const map = new Map<string, { retard: number; essaiUnique: number }>();
    for (const a of alerts) {
      const cur = map.get(a.accountId) ?? { retard: 0, essaiUnique: 0 };
      if (a.status === "retard") cur.retard++;
      if (a.status === "essai_unique") cur.essaiUnique++;
      map.set(a.accountId, cur);
    }
    return map;
  }, [alerts]);

  const nextOrderByAccount = useMemo(() => {
    const map = new Map<string, { date: string; brand: string; confidence: string }>();
    for (const p of predictions) {
      if (!p.expectedNextOrderDate) continue;
      const cur = map.get(p.accountId);
      if (!cur || p.expectedNextOrderDate < cur.date) {
        map.set(p.accountId, { date: p.expectedNextOrderDate, brand: p.brand, confidence: p.confidence });
      }
    }
    return map;
  }, [predictions]);

  const rows = useMemo(() => {
    return accounts
      .map((a) => {
        const rfms = rfmsByAccount.get(a.id) ?? null;
        const tier = tiers.get(a.id) ?? null;
        const matrix = matrixByAccount.get(a.id) ?? null;
        const alertCounts = alertsByAccount.get(a.id) ?? { retard: 0, essaiUnique: 0 };
        const nextOrder = nextOrderByAccount.get(a.id) ?? null;
        const q3 = q3ByAccount.get(a.id) ?? null;
        return { account: a, rfms, tier, matrix, alertCounts, nextOrder, q3 };
      })
      .filter((r) => r.rfms !== null); // seuls les comptes avec au moins un achat historique sont scorables
  }, [accounts, rfmsByAccount, tiers, matrixByAccount, alertsByAccount, nextOrderByAccount, q3ByAccount]);

  const filteredRows = useMemo(() => {
    return rows
      .filter((r) => (search ? r.account.name.toLowerCase().includes(search.toLowerCase()) : true))
      .filter((r) => (tierFilter === "all" ? true : r.tier === tierFilter))
      .filter((r) => (quadrantFilter === "all" ? true : r.matrix?.quadrant === quadrantFilter));
  }, [rows, search, tierFilter, quadrantFilter]);

  const { sorted, sortKey, dir, toggle } = useSortableTable<(typeof filteredRows)[number], SortKey>(
    filteredRows,
    {
      name: (r) => r.account.name,
      segment: (r) => r.account.segment,
      score: (r) => r.rfms?.sonarScore ?? null,
      tier: (r) => r.tier,
      quadrant: (r) => r.matrix?.quadrant ?? null,
      avancement: (r) => r.matrix?.progress.avancementPct ?? null,
      retard: (r) => r.alertCounts.retard,
      prochaine: (r) => r.nextOrder?.date ?? null,
      q3: (r) => r.q3?.totalExpectedQty ?? null,
    },
    "score"
  );

  const tierCounts = useMemo(() => {
    const counts: Record<SonarTier, number> = { tier_1: 0, tier_2: 0, tier_3: 0, tier_4: 0 };
    for (const t of tiers.values()) counts[t]++;
    return counts;
  }, [tiers]);

  const totalRetard = alerts.filter((a) => a.status === "retard").length;
  const totalEssaiUnique = alerts.filter((a) => a.status === "essai_unique").length;
  const totalQ3Boites = q3Forecast.reduce((s, f) => s + f.totalExpectedQty, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Comptes scorés</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{rows.length}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">sur {accounts.length} comptes — nécessite un historique d&apos;achat daté</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Répartition tiers</p>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full">
              {(Object.keys(TIER_META) as SonarTier[]).map((t) => (
                <div
                  key={t}
                  style={{ width: `${rows.length ? (tierCounts[t] / rows.length) * 100 : 0}%`, backgroundColor: TIER_COLOR[t] }}
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              T1 {tierCounts.tier_1} · T2 {tierCounts.tier_2} · T3 {tierCounts.tier_3} · T4 {tierCounts.tier_4}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle size={14} className="text-danger" /> Vrais retards détectés
            </div>
            <p className="mt-1 text-2xl font-semibold text-foreground">{totalRetard}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">combinaisons compte × marque, ≥ 2 achats, rythme rompu</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FlaskConical size={14} className="text-amber-600" /> Essais uniques
            </div>
            <p className="mt-1 text-2xl font-semibold text-foreground">{totalEssaiUnique}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">un seul achat — pas un retard, un essai jamais transformé</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Target size={14} className="text-primary" /> Volume Q3 prévu
            </div>
            <p className="mt-1 text-2xl font-semibold text-foreground">{formatNumber(totalQ3Boites)} boîtes</p>
            <p className="mt-1 text-[11px] text-muted-foreground">juil-sept 2026 — à comparer au réalisé fin de trimestre</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Comptes — SonarScore, matrice contrat, prévision d&apos;achat</CardTitle>
            <CardDescription>
              RFM-S en coexistence avec le score de ciblage existant. Cliquez sur un compte pour ouvrir sa fiche.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Rechercher un compte..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm"
            />
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as SonarTier | "all")}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            >
              <option value="all">Tous les tiers</option>
              {(Object.keys(TIER_META) as SonarTier[]).map((t) => (
                <option key={t} value={t}>
                  {TIER_META[t].label} ({TIER_META[t].percentile})
                </option>
              ))}
            </select>
            <select
              value={quadrantFilter}
              onChange={(e) => setQuadrantFilter(e.target.value as MatrixQuadrant | "all")}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            >
              <option value="all">Tous les quadrants</option>
              {(Object.keys(QUADRANT_META) as MatrixQuadrant[]).map((q) => (
                <option key={q} value={q}>
                  {QUADRANT_META[q].label}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">{filteredRows.length} compte(s)</span>
          </div>

          <div className="max-h-[36rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <SortableTh label="Compte" sortKey="name" activeKey={sortKey} dir={dir} onSort={toggle} className="px-3" />
                  <SortableTh label="Seg" sortKey="segment" activeKey={sortKey} dir={dir} onSort={toggle} className="px-2" />
                  <SortableTh label="SonarScore" sortKey="score" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-2" />
                  <SortableTh label="Tier" sortKey="tier" activeKey={sortKey} dir={dir} onSort={toggle} className="px-2" />
                  <SortableTh label="Quadrant contrat" sortKey="quadrant" activeKey={sortKey} dir={dir} onSort={toggle} className="px-2" />
                  <SortableTh label="Avancement" sortKey="avancement" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-2" />
                  <SortableTh label="Retards" sortKey="retard" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-2" />
                  <SortableTh label="Prochaine commande prévue" sortKey="prochaine" activeKey={sortKey} dir={dir} onSort={toggle} className="px-2" />
                  <SortableTh label="Volume Q3 prévu" sortKey="q3" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-3" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.account.id} className="border-b border-border/60 hover:bg-surface-muted">
                    <td className="px-3 py-2">
                      <Link href={`/comptes/${r.account.id}`} className="font-medium text-foreground hover:text-primary">
                        {r.account.name}
                      </Link>
                      <p className="text-[11px] text-muted-foreground">{r.account.city ?? "—"} · {r.account.price_list ?? "palier ?"}</p>
                    </td>
                    <td className="px-2 py-2">{r.account.segment ? <SegmentBadge segment={r.account.segment} /> : "—"}</td>
                    <td className="px-2 py-2 text-right font-semibold">{r.rfms?.sonarScore ?? "—"}</td>
                    <td className="px-2 py-2">
                      {r.tier ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                          style={{ backgroundColor: TIER_COLOR[r.tier] }}
                        >
                          {TIER_META[r.tier].label}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {r.matrix ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                          style={{ backgroundColor: QUADRANT_META[r.matrix.quadrant].color }}
                          title={QUADRANT_META[r.matrix.quadrant].description}
                        >
                          {QUADRANT_META[r.matrix.quadrant].label}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {r.matrix?.progress.avancementPct !== null && r.matrix?.progress.avancementPct !== undefined
                        ? `${r.matrix.progress.avancementPct}%`
                        : "—"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {r.alertCounts.retard > 0 ? (
                        <span className="font-semibold text-danger">{r.alertCounts.retard}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                      {r.alertCounts.essaiUnique > 0 && (
                        <span className="ml-1 text-[10px] text-amber-600">({r.alertCounts.essaiUnique} essai)</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {r.nextOrder ? (
                        <>
                          <span className="text-foreground">{r.nextOrder.date}</span>
                          <span className="text-muted-foreground"> · {r.nextOrder.brand}</span>
                          {r.nextOrder.confidence === "marque" && (
                            <span className="ml-1 text-[10px] text-amber-600" title="Peu d'historique sur ce compte, repli sur la vélocité de la marque">
                              (estim. marque)
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">donnée insuffisante</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.q3 ? (
                        <span className="inline-flex items-center gap-1 font-medium text-foreground">
                          <TrendingUp size={12} className="text-primary" /> {formatNumber(r.q3.totalExpectedQty)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vélocités de réapprovisionnement par référence</CardTitle>
          <CardDescription>Médiane des intervalles réels entre achats du même compte, calculée dynamiquement — pas une constante en dur.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from(brandVelocities.values())
              .sort((a, b) => (a.medianDays ?? 0) - (b.medianDays ?? 0))
              .map((v) => (
                <div key={v.brand} className="rounded-lg border border-border p-2 text-xs">
                  <p className="font-medium text-foreground">{v.brand}</p>
                  <p className="text-muted-foreground">
                    {v.medianDays ? `${v.medianDays}j` : "—"} · {v.accountsWithRepeatPurchase} compte(s) récurrent(s)
                  </p>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
