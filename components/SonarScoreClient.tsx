"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { SegmentBadge } from "@/components/ui/Badge";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatNumber, formatPct } from "@/lib/utils";
import { computeBrandVelocities, computeProductAlerts, type PurchaseLine } from "@/lib/sonarscore/velocity";
import { computeRfmsScores, assignSonarTiers, TIER_META, type SonarTier } from "@/lib/sonarscore/rfms";
import { buildContractMatrix, QUADRANT_META, type MatrixQuadrant } from "@/lib/sonarscore/contractMatrix";
import { predictNextOrders, forecastForPeriod } from "@/lib/sonarscore/prediction";
import { runForecastBacktest, runBrandBacktest } from "@/lib/forecast-backtest";
import type { BacktestPurchaseLine, BacktestResult, BrandBacktestReport } from "@/lib/forecast-backtest";
import type { Account, AccountProductPurchase } from "@/types/database";
import { TrendingUp, AlertTriangle, FlaskConical, Target } from "lucide-react";

type AccountSlim = Account;
type PurchaseSlim = Pick<AccountProductPurchase, "account_id" | "brand" | "purchase_date" | "qty" | "value_eur">;

type SortKey = "name" | "segment" | "score" | "tier" | "quadrant" | "avancement" | "retard" | "prochaine" | "q3";

const TIER_COLOR: Record<SonarTier, string> = {
  tier_1: "#16a34a",
  tier_2: "#4f46e5",
  tier_3: "#d97706",
  tier_4: "#94a3b8",
};

const MONTH_LABELS_FULL = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

// Q3 2026 — fenêtre de test explicite (à ajuster si le calendrier de
// validation change).
const Q3_START = "2026-07-01";
const Q3_END = "2026-09-30";

export function SonarScoreClient({ accounts, purchases }: { accounts: AccountSlim[]; purchases: PurchaseSlim[] }) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<SonarTier | "all">("all");
  const [quadrantFilter, setQuadrantFilter] = useState<MatrixQuadrant | "all">("all");
  const [backtestWindow, setBacktestWindow] = useState<1 | 2 | 3 | 6>(3);
  const [backtestCategoryFilter, setBacktestCategoryFilter] = useState<"all" | "filler" | "dermo">("all");

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

  // ── Backtest : rejoue le générateur à "aujourd'hui − N mois" avec
  // uniquement les données disponibles à l'époque, compare aux commandes
  // réellement passées depuis (déjà en base) — sur la fenêtre des N derniers
  // mois complets, pour que tous les mois testés soient bien dans le passé.
  const backtestCutoff = useMemo(() => {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1 - backtestWindow;
    while (month < 1) {
      month += 12;
      year -= 1;
    }
    return { year, month };
  }, [backtestWindow]);

  const backtestLines: BacktestPurchaseLine[] = useMemo(
    () =>
      purchaseLines.map((p) => ({
        account_id: p.account_id,
        brand: p.brand,
        purchase_date: p.purchase_date,
        qty: p.qty,
        value_eur: p.value_eur,
      })),
    [purchaseLines]
  );

  const backtestResult: BacktestResult = useMemo(
    () => runForecastBacktest(accounts, backtestLines, backtestCutoff.year, backtestCutoff.month, backtestWindow),
    [accounts, backtestLines, backtestCutoff, backtestWindow]
  );

  const brandBacktestReport: BrandBacktestReport = useMemo(
    () => runBrandBacktest(backtestLines, backtestCutoff.year, backtestCutoff.month, backtestWindow),
    [backtestLines, backtestCutoff, backtestWindow]
  );

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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Backtest — le signal produit améliore-t-il vraiment le générateur Pilotage ?</CardTitle>
              <CardDescription>
                Rejoue le générateur (lib/forecast.ts) à &quot;aujourd&apos;hui − N mois&quot; avec seulement les données
                connues à l&apos;époque, et compare ses prévisions aux commandes réellement passées depuis — deux
                variantes : avec et sans le signal produit (RHA4/RHA3...), sur les mêmes données par ailleurs.
              </CardDescription>
            </div>
            <select
              value={backtestWindow}
              onChange={(e) => setBacktestWindow(Number(e.target.value) as 1 | 2 | 3 | 6)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            >
              <option value={1}>Dernier mois</option>
              <option value={2}>2 derniers mois</option>
              <option value={3}>3 derniers mois</option>
              <option value={6}>6 derniers mois</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Fenêtre testée : {MONTH_LABELS_FULL[backtestResult.targetMonths[0].month - 1]} {backtestResult.targetMonths[0].year}
            {" → "}
            {MONTH_LABELS_FULL[backtestResult.targetMonths[backtestResult.targetMonths.length - 1].month - 1]}{" "}
            {backtestResult.targetMonths[backtestResult.targetMonths.length - 1].year} · basé sur ce qui était connu
            avant le {MONTH_LABELS_FULL[backtestResult.cutoff.month - 1]} {backtestResult.cutoff.year}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[backtestResult.withProductSignal, backtestResult.withoutProductSignal].map((v) => (
              <div key={v.label} className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-semibold text-foreground">{v.label}</p>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Précision (prévisions confirmées par une vraie commande)</span>
                    <span className="font-medium text-foreground">
                      {v.precision !== null ? formatPct(v.precision) : "—"} ({v.hits}/{v.predictedCount})
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Rappel (mois réellement commandés qui ont été anticipés)</span>
                    <span className="font-medium text-foreground">
                      {v.recall !== null ? formatPct(v.recall) : "—"} ({v.hits}/{v.actualOrderMonths})
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>F1 (équilibre précision/rappel)</span>
                    <span className="font-medium text-foreground">{v.f1 !== null ? formatPct(v.f1) : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Biais de montant (sur les mois correctement anticipés)</span>
                    <span className={`font-medium ${v.caBiasPct !== null && v.caBiasPct > 0 ? "text-amber-600" : "text-foreground"}`}>
                      {v.caBiasPct !== null ? `${v.caBiasPct >= 0 ? "+" : ""}${formatPct(v.caBiasPct)}` : "—"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Rappel et précision comptent un &quot;succès&quot; dès qu&apos;un compte prévu ce mois-ci a effectivement commandé
            (n&apos;importe quelle marque) — le biais de montant compare ensuite le CA prévu au CA réel, uniquement sur ces
            succès, pour isoler l&apos;erreur de montant de l&apos;erreur de timing. Fenêtre courte (1-2 mois) = échantillon
            réduit, à interpréter avec prudence.
          </p>

          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-foreground">Détail par référence</p>
              <div className="flex rounded-lg border border-border bg-surface p-0.5">
                {([
                  { key: "all", label: "Toutes" },
                  { key: "filler", label: "Fillers" },
                  { key: "dermo", label: "Dermo" },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setBacktestCategoryFilter(key)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      backtestCategoryFilter === key
                        ? "bg-primary-100 text-primary-700"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">
              Même principe, mais par marque : &quot;prévu&quot; = une prédiction compte × marque dont la date attendue tombe
              dans la fenêtre ; &quot;succès&quot; = ce compte a bien racheté CETTE marque ce mois-là (pas une autre). Les 12
              fillers connus restent toujours affichés, même à 0 (pas assez d&apos;historique — état normal). Les
              références &quot;Dermo&quot; couvrent le reste : vraie gamme cosmétique, mais aussi d&apos;éventuelles lignes non
              commerciales (bandeaux, cartes implant) si elles remontent comme &quot;marque&quot; à l&apos;import — un score
              proche de zéro sur ces dernières est attendu, pas un défaut du modèle.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1.5 font-medium">Référence</th>
                    <th className="px-2 py-1.5 font-medium">Catégorie</th>
                    <th className="px-2 py-1.5 text-right font-medium">Prévu</th>
                    <th className="px-2 py-1.5 text-right font-medium">Succès</th>
                    <th className="px-2 py-1.5 text-right font-medium">Précision</th>
                    <th className="px-2 py-1.5 text-right font-medium">Réel</th>
                    <th className="px-2 py-1.5 text-right font-medium">Rappel</th>
                    <th className="px-2 py-1.5 text-right font-medium">F1</th>
                  </tr>
                </thead>
                <tbody>
                  {brandBacktestReport.brands
                    .filter((b) => (backtestCategoryFilter === "all" ? true : b.category === backtestCategoryFilter))
                    .map((b) => (
                      <tr key={b.brand} className="border-b border-border/60 last:border-0">
                        <td className="px-2 py-1.5 font-medium text-foreground">{b.brand}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                              b.category === "filler"
                                ? "bg-primary-50 text-primary-700"
                                : "bg-surface-muted text-muted-foreground"
                            }`}
                          >
                            {b.category === "filler" ? "Filler" : "Dermo"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground">{b.predictedCount}</td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground">{b.hits}</td>
                        <td className="px-2 py-1.5 text-right font-medium text-foreground">
                          {b.precision !== null ? formatPct(b.precision) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground">{b.actualOrderCount}</td>
                        <td className="px-2 py-1.5 text-right font-medium text-foreground">
                          {b.recall !== null ? formatPct(b.recall) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium text-foreground">
                          {b.f1 !== null ? formatPct(b.f1) : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
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
