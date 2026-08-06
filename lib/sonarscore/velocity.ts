// Vélocités de réapprovisionnement par référence — calculées dynamiquement
// depuis l'historique réel d'achats (account_product_purchases), jamais en
// dur. Remplace l'approche "35j pour RHA1, 40j pour RHA2..." qui n'a jamais
// été validée sur données réelles : le backtest utilisateur montre des
// écarts de 2 à 3x avec la réalité (RHA1 = 95j, pas 35j).

export interface PurchaseLine {
  account_id: string;
  brand: string;
  purchase_date: string; // ISO yyyy-mm-dd
  qty: number;
}

export interface BrandVelocity {
  brand: string;
  medianDays: number | null; // médiane des intervalles entre achats du même compte, tous comptes confondus
  sampleSize: number; // nombre d'intervalles utilisés (comptes ayant acheté ≥ 2 fois)
  accountsWithRepeatPurchase: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/** Regroupe les lignes par compte × marque, triées par date. */
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
 * Médiane des intervalles entre achats consécutifs du même compte pour
 * chaque marque — c'est la vélocité "normale" de réapprovisionnement de
 * cette référence sur le portefeuille réel, pas une hypothèse produit.
 */
export function computeBrandVelocities(lines: PurchaseLine[]): Map<string, BrandVelocity> {
  const grouped = groupByAccountBrand(lines);
  const intervalsByBrand = new Map<string, number[]>();
  const repeatAccountsByBrand = new Map<string, Set<string>>();

  for (const [key, purchases] of grouped) {
    const [accountId, brand] = key.split("|");
    if (purchases.length < 2) continue;
    const intervals = intervalsByBrand.get(brand) ?? [];
    for (let i = 1; i < purchases.length; i++) {
      const gap = daysBetween(purchases[i - 1].purchase_date, purchases[i].purchase_date);
      if (gap > 0) intervals.push(gap);
    }
    intervalsByBrand.set(brand, intervals);
    const set = repeatAccountsByBrand.get(brand) ?? new Set<string>();
    set.add(accountId);
    repeatAccountsByBrand.set(brand, set);
  }

  const result = new Map<string, BrandVelocity>();
  for (const [brand, intervals] of intervalsByBrand) {
    result.set(brand, {
      brand,
      medianDays: median(intervals),
      sampleSize: intervals.length,
      accountsWithRepeatPurchase: repeatAccountsByBrand.get(brand)?.size ?? 0,
    });
  }
  return result;
}

export type ProductAlertStatus = "essai_unique" | "retard" | "normal" | "inconnu";

export interface ProductAlert {
  accountId: string;
  brand: string;
  status: ProductAlertStatus;
  daysSinceLastPurchase: number;
  expectedVelocityDays: number | null;
  ratio: number | null; // daysSinceLastPurchase / expectedVelocityDays
  purchaseCount: number;
}

const RETARD_THRESHOLD_RATIO = 1.5; // 50% au-delà de la vélocité habituelle = retard

/**
 * Distingue "essai unique jamais racheté" (un seul achat historique — pas
 * de cycle à rompre, donc pas un vrai retard) d'une vraie anomalie de
 * réapprovisionnement (≥ 2 achats, rythme rompu par rapport à la vélocité
 * habituelle de cette référence). Le backtest a montré qu'environ la moitié
 * des "retards" détectés avec l'ancienne logique étaient en fait des essais
 * uniques — un signal différent (essai jamais transformé), pas un retard.
 */
export function computeProductAlerts(
  lines: PurchaseLine[],
  velocities: Map<string, BrandVelocity>,
  asOf: Date = new Date()
): ProductAlert[] {
  const grouped = groupByAccountBrand(lines);
  const alerts: ProductAlert[] = [];

  for (const [key, purchases] of grouped) {
    const [accountId, brand] = key.split("|");
    const last = purchases[purchases.length - 1];
    const daysSince = daysBetween(last.purchase_date, asOf.toISOString().slice(0, 10));
    const velocity = velocities.get(brand)?.medianDays ?? null;

    if (purchases.length === 1) {
      alerts.push({
        accountId,
        brand,
        status: "essai_unique",
        daysSinceLastPurchase: daysSince,
        expectedVelocityDays: velocity,
        ratio: null,
        purchaseCount: 1,
      });
      continue;
    }

    if (velocity === null) {
      alerts.push({
        accountId,
        brand,
        status: "inconnu",
        daysSinceLastPurchase: daysSince,
        expectedVelocityDays: null,
        ratio: null,
        purchaseCount: purchases.length,
      });
      continue;
    }

    const ratio = daysSince / velocity;
    alerts.push({
      accountId,
      brand,
      status: ratio >= RETARD_THRESHOLD_RATIO ? "retard" : "normal",
      daysSinceLastPurchase: daysSince,
      expectedVelocityDays: velocity,
      ratio,
      purchaseCount: purchases.length,
    });
  }

  return alerts;
}
