// Prédiction d'achat — pour chaque compte × marque, prédit la prochaine
// date de commande probable et le volume attendu, à partir du rythme
// PROPRE au compte quand on a assez d'historique, avec repli sur la
// vélocité de la marque (population) quand l'historique du compte est trop
// court. Objectif explicite : comparer prédiction vs réalisé sur le Q3
// 2026 pour valider (ou recalibrer) l'approche avant de s'y fier.
//
// Approche volontairement simple à cette étape (repli à 2 niveaux, pas de
// modèle statistique plus poussé) — le but du test Q3 est justement de
// mesurer si c'est suffisant ou s'il faut complexifier (saisonnalité,
// pondération récence des intervalles, etc.).

import type { BrandVelocity, PurchaseLine } from "./velocity";

export type PredictionConfidence = "compte" | "marque" | "insuffisante";

export interface AccountBrandPrediction {
  accountId: string;
  brand: string;
  lastPurchaseDate: string;
  expectedNextOrderDate: string | null;
  expectedQty: number | null;
  confidence: PredictionConfidence;
  intervalUsedDays: number | null;
  purchaseCount: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

function groupByAccountBrand(lines: PurchaseLine[]): Map<string, PurchaseLine[]> {
  const map = new Map<string, PurchaseLine[]>();
  for (const line of lines) {
    const key = `${line.account_id}|${line.brand}`;
    const arr = map.get(key) ?? [];
    arr.push(line);
    map.set(key, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.purchase_date.localeCompare(b.purchase_date));
  return map;
}

/**
 * Prédit, pour chaque combinaison compte × marque ayant au moins un achat,
 * la prochaine date de commande probable :
 *  - ≥ 3 achats du compte sur cette marque -> rythme PROPRE au compte
 *    (médiane de ses propres intervalles), confiance "compte".
 *  - 2 achats seulement -> l'unique intervalle du compte, confiance "compte"
 *    mais à interpréter avec prudence (un seul point de mesure).
 *  - 1 achat (essai unique) -> repli sur la vélocité de la marque si elle
 *    existe (assez d'autres comptes récurrents), confiance "marque" ;
 *    sinon confiance "insuffisante" (pas de prédiction chiffrée).
 */
export function predictNextOrders(
  lines: PurchaseLine[],
  brandVelocities: Map<string, BrandVelocity>
): AccountBrandPrediction[] {
  const grouped = groupByAccountBrand(lines);
  const predictions: AccountBrandPrediction[] = [];

  for (const [key, purchases] of grouped) {
    const [accountId, brand] = key.split("|");
    const last = purchases[purchases.length - 1];
    const qtys = purchases.map((p) => p.qty);
    const expectedQty = median(qtys);

    if (purchases.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < purchases.length; i++) {
        intervals.push(
          (new Date(purchases[i].purchase_date).getTime() - new Date(purchases[i - 1].purchase_date).getTime()) /
            86400000
        );
      }
      const ownInterval = median(intervals)!;
      predictions.push({
        accountId,
        brand,
        lastPurchaseDate: last.purchase_date,
        expectedNextOrderDate: addDays(last.purchase_date, ownInterval),
        expectedQty,
        confidence: "compte",
        intervalUsedDays: Math.round(ownInterval),
        purchaseCount: purchases.length,
      });
      continue;
    }

    // essai unique — repli sur la vélocité de la marque si assez de données
    const brandVelocity = brandVelocities.get(brand);
    if (brandVelocity?.medianDays && brandVelocity.accountsWithRepeatPurchase >= 5) {
      predictions.push({
        accountId,
        brand,
        lastPurchaseDate: last.purchase_date,
        expectedNextOrderDate: addDays(last.purchase_date, brandVelocity.medianDays),
        expectedQty,
        confidence: "marque",
        intervalUsedDays: Math.round(brandVelocity.medianDays),
        purchaseCount: 1,
      });
    } else {
      predictions.push({
        accountId,
        brand,
        lastPurchaseDate: last.purchase_date,
        expectedNextOrderDate: null,
        expectedQty: null,
        confidence: "insuffisante",
        intervalUsedDays: null,
        purchaseCount: 1,
      });
    }
  }

  return predictions;
}

export interface PeriodForecast {
  accountId: string;
  expectedOrders: { brand: string; expectedDate: string; expectedQty: number; confidence: PredictionConfidence }[];
  totalExpectedQty: number;
}

/**
 * Agrège les prédictions individuelles dont la date attendue tombe dans la
 * période donnée (ex. Q3 2026 : "2026-07-01".."2026-09-30") — sert à
 * construire un prévisionnel de volume comparable au réalisé une fois la
 * période écoulée.
 */
export function forecastForPeriod(
  predictions: AccountBrandPrediction[],
  periodStart: string,
  periodEnd: string
): PeriodForecast[] {
  const byAccount = new Map<string, PeriodForecast>();
  for (const p of predictions) {
    if (!p.expectedNextOrderDate || p.expectedQty === null) continue;
    if (p.expectedNextOrderDate < periodStart || p.expectedNextOrderDate > periodEnd) continue;
    const entry = byAccount.get(p.accountId) ?? { accountId: p.accountId, expectedOrders: [], totalExpectedQty: 0 };
    entry.expectedOrders.push({
      brand: p.brand,
      expectedDate: p.expectedNextOrderDate,
      expectedQty: p.expectedQty,
      confidence: p.confidence,
    });
    entry.totalExpectedQty += p.expectedQty;
    byAccount.set(p.accountId, entry);
  }
  return Array.from(byAccount.values());
}

/**
 * Compare une prévision de période à ce qui a réellement été acheté (une
 * fois la période écoulée) — objectif : mesurer précision (taux de
 * commandes prédites qui ont bien eu lieu dans la période ± tolérance) et
 * biais (sur/sous-estimation du volume), pour valider ou recalibrer le
 * modèle après le Q3.
 */
export function comparePeriodForecastToActual(
  forecasts: PeriodForecast[],
  actualPurchases: PurchaseLine[],
  periodStart: string,
  periodEnd: string
): {
  accountId: string;
  expectedQty: number;
  actualQty: number;
  delta: number;
  brandsHit: number;
  brandsExpected: number;
}[] {
  const actualByAccountBrand = new Map<string, number>();
  for (const p of actualPurchases) {
    if (p.purchase_date < periodStart || p.purchase_date > periodEnd) continue;
    const key = `${p.account_id}|${p.brand}`;
    actualByAccountBrand.set(key, (actualByAccountBrand.get(key) ?? 0) + p.qty);
  }

  return forecasts.map((f) => {
    let actualQty = 0;
    let brandsHit = 0;
    for (const o of f.expectedOrders) {
      const actual = actualByAccountBrand.get(`${f.accountId}|${o.brand}`) ?? 0;
      actualQty += actual;
      if (actual > 0) brandsHit++;
    }
    return {
      accountId: f.accountId,
      expectedQty: f.totalExpectedQty,
      actualQty,
      delta: actualQty - f.totalExpectedQty,
      brandsHit,
      brandsExpected: f.expectedOrders.length,
    };
  });
}
