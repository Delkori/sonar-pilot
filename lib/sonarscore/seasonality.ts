// Signal saisonnier — indépendant du rythme par intervalle (velocity.ts /
// prediction.ts) : un compte peut racheter une marque autour de la même
// période de l'année plutôt qu'à intervalle fixe depuis son dernier achat
// (ex. avant l'été, campagne de printemps...). Un achat en mars 2025 peut se
// retrouver en mars, avril OU mai 2026 chez ce même compte — la tolérance
// ±1 mois fait partie du signal lui-même, pas d'un assouplissement a
// posteriori de l'évaluation.
//
// Nécessite au moins 2 années civiles distinctes d'achat autour du même mois
// pour ce compte × marque : un seul point ne prouve rien, ça peut être une
// coïncidence de calendrier plutôt qu'un vrai motif récurrent.

import type { PurchaseLine } from "./velocity";
import type { AccountBrandPrediction } from "./prediction";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface SeasonalAnniversary {
  brand: string;
  anniversaryMonth: number; // 1-12
  yearsObserved: number;
  qtys: number[];
}

/**
 * Détecte, pour chaque compte × marque, le ou les mois "anniversaire" : un
 * mois calendaire où un achat a eu lieu, retrouvé à ± toleranceMonths près
 * sur au moins 2 années civiles distinctes. Un seul achat par an "ancre" ce
 * motif (le premier de l'année s'il y en a plusieurs — un compte qui achète
 * cette marque plusieurs fois par an n'a pas besoin du signal saisonnier,
 * l'intervalle s'en charge déjà mieux). Les ancrages proches (± tolérance)
 * d'une année sur l'autre sont regroupés en un seul motif, ancré sur le mois
 * le plus récent — pas un motif par mois de la fenêtre de tolérance.
 */
export function computeSeasonalAnniversaries(
  lines: PurchaseLine[],
  toleranceMonths = 1
): Map<string, SeasonalAnniversary[]> {
  const groups = new Map<string, Map<number, { month: number; qty: number }[]>>(); // key -> année -> achats de l'année

  for (const l of lines) {
    const d = new Date(l.purchase_date);
    const key = `${l.account_id}|${l.brand}`;
    const year = d.getFullYear();
    const byYear = groups.get(key) ?? new Map<number, { month: number; qty: number }[]>();
    const arr = byYear.get(year) ?? [];
    arr.push({ month: d.getMonth() + 1, qty: l.qty });
    byYear.set(year, arr);
    groups.set(key, byYear);
  }

  const result = new Map<string, SeasonalAnniversary[]>();
  for (const [key, byYear] of groups) {
    const [accountId, brand] = key.split("|");
    if (byYear.size < 2) continue; // besoin d'au moins 2 années distinctes pour parler de motif

    const anchors = Array.from(byYear.entries())
      .map(([year, purchases]) => ({ year, month: purchases[0].month, qty: purchases[0].qty }))
      .sort((a, b) => a.year - b.year);

    const used = new Array(anchors.length).fill(false);
    const signals: SeasonalAnniversary[] = [];
    for (let i = 0; i < anchors.length; i++) {
      if (used[i]) continue;
      const cluster = [anchors[i]];
      used[i] = true;
      for (let j = i + 1; j < anchors.length; j++) {
        if (used[j]) continue;
        const rawDiff = Math.abs(anchors[j].month - anchors[i].month);
        const circularDiff = Math.min(rawDiff, 12 - rawDiff);
        if (circularDiff <= toleranceMonths) {
          cluster.push(anchors[j]);
          used[j] = true;
        }
      }
      const distinctYears = new Set(cluster.map((c) => c.year));
      if (distinctYears.size >= 2) {
        const mostRecent = cluster[cluster.length - 1]; // anchors triés par année croissante
        signals.push({
          brand,
          anniversaryMonth: mostRecent.month,
          yearsObserved: distinctYears.size,
          qtys: cluster.map((c) => c.qty),
        });
      }
    }
    if (signals.length > 0) result.set(accountId, signals);
  }
  return result;
}

/**
 * Transforme les anniversaires détectés en prédictions du même format que
 * `predictNextOrders` (intervalle) — un point de date par compte × marque :
 * la PROCHAINE occurrence du mois anniversaire à partir de `asOfMonthIndex`
 * (année×12+mois), toujours dans le futur par construction. `expectedQty`
 * reprend la médiane des quantités observées ces années-là.
 */
export function predictSeasonalOrders(
  lines: PurchaseLine[],
  asOfMonthIndex: number,
  toleranceMonths = 1
): AccountBrandPrediction[] {
  const anniversaries = computeSeasonalAnniversaries(lines, toleranceMonths);

  const lastPurchaseByKey = new Map<string, string>();
  for (const l of lines) {
    const key = `${l.account_id}|${l.brand}`;
    const cur = lastPurchaseByKey.get(key);
    if (!cur || l.purchase_date > cur) lastPurchaseByKey.set(key, l.purchase_date);
  }

  const asOfYear = Math.floor((asOfMonthIndex - 1) / 12);

  const predictions: AccountBrandPrediction[] = [];
  for (const [accountId, signals] of anniversaries) {
    for (const signal of signals) {
      const key = `${accountId}|${signal.brand}`;
      const lastPurchaseDate = lastPurchaseByKey.get(key)!;

      let targetIdx = asOfYear * 12 + signal.anniversaryMonth;
      if (targetIdx <= asOfMonthIndex) targetIdx += 12; // ce mois-ci est déjà passé/en cours -> vise l'an prochain

      const targetYear = Math.floor((targetIdx - 1) / 12);
      const targetMonth = targetIdx - targetYear * 12;

      predictions.push({
        accountId,
        brand: signal.brand,
        lastPurchaseDate,
        expectedNextOrderDate: `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`,
        expectedQty: median(signal.qtys),
        confidence: "saisonnier",
        intervalUsedDays: null,
        purchaseCount: signal.yearsObserved,
      });
    }
  }
  return predictions;
}
