// SonarScore — RFM-S calibré statistiquement sur la population réelle du
// portefeuille, PAS un score à poids fixes (25/25/25/25) comme l'ancien
// score de ciblage (lib/scoring.ts, inchangé — ce module vit à côté, en
// coexistence, pour comparaison sur plusieurs semaines).
//
// Composantes :
//  - Récence   : rang percentile de "jours depuis le dernier achat" dans la
//                population (pas un seuil universel en semaines).
//  - Fréquence : rang percentile du nombre de commandes sur 12 mois glissants.
//  - Monétaire : rang percentile du CA sur 12 mois glissants (pas un seuil
//                absolu en k€ — reste valide même si le portefeuille change
//                d'échelle).
//  - Stabilité : coefficient de variation (écart-type / moyenne) des
//                intervalles entre commandes — distingue un client
//                "métronome" (CV faible) d'un client erratique (CV élevé).
//  - Momentum  : pente de tendance (régression linéaire) sur la valeur des
//                6 dernières commandes.
//
// Les poids par défaut sont volontairement modestes et ajustables — ce
// n'est pas le seul livrable : chaque sous-score reste exposé séparément
// pour rester explicable à l'utilisateur terrain (cf. tâche #56, réglage du
// score déjà identifié comme travail futur).

import type { PurchaseLine } from "./velocity";

export interface AccountOrder {
  date: string; // ISO
  value: number;
}

export interface RfmsSubScores {
  recence: number | null; // 0-100, 100 = achat très récent
  frequence: number | null; // 0-100
  monetaire: number | null; // 0-100
  stabilite: number | null; // 0-100, 100 = rythme très régulier
  momentum: number | null; // 0-100, 100 = forte accélération récente
}

export interface AccountRfmsResult {
  accountId: string;
  sub: RfmsSubScores;
  sonarScore: number | null; // moyenne pondérée des sous-scores disponibles
  orderCount12m: number;
  totalValue12m: number;
  daysSinceLastOrder: number | null;
  coefficientVariation: number | null;
}

const WEIGHTS = { recence: 0.3, frequence: 0.2, monetaire: 0.3, stabilite: 0.1, momentum: 0.1 };

function percentileRank(values: number[], value: number): number {
  if (values.length === 0) return 50;
  const below = values.filter((v) => v < value).length;
  const equal = values.filter((v) => v === value).length;
  return Math.round(((below + equal / 2) / values.length) * 100);
}

function linearRegressionSlope(points: { x: number; y: number }[]): number | null {
  const n = points.length;
  if (n < 2) return null;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

function groupByAccount(lines: (PurchaseLine & { value_eur: number })[]): Map<string, AccountOrder[]> {
  // Regroupe par compte × date (une "commande" = toutes les lignes du même
  // jour) plutôt que par ligne produit individuelle.
  const byAccountDate = new Map<string, Map<string, number>>();
  for (const line of lines) {
    const dates = byAccountDate.get(line.account_id) ?? new Map<string, number>();
    const prev = dates.get(line.purchase_date) ?? 0;
    dates.set(line.purchase_date, prev + line.value_eur);
    byAccountDate.set(line.account_id, dates);
  }
  const result = new Map<string, AccountOrder[]>();
  for (const [accountId, dates] of byAccountDate) {
    const orders = Array.from(dates.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
    result.set(accountId, orders);
  }
  return result;
}

/**
 * Calcule le SonarScore (RFM-S) pour chaque compte ayant au moins un achat
 * dans l'historique fourni. `asOf` fixe la date de référence (permet de
 * rejouer le calcul à une date passée pour un backtest).
 */
export function computeRfmsScores(
  purchasesWithValue: (PurchaseLine & { value_eur: number })[],
  asOf: Date = new Date()
): AccountRfmsResult[] {
  const ordersByAccount = groupByAccount(purchasesWithValue);
  const asOfStr = asOf.toISOString().slice(0, 10);
  const cutoff12m = new Date(asOf);
  cutoff12m.setFullYear(cutoff12m.getFullYear() - 1);
  const cutoff12mStr = cutoff12m.toISOString().slice(0, 10);

  interface Raw {
    accountId: string;
    daysSinceLastOrder: number | null;
    orderCount12m: number;
    totalValue12m: number;
    coefficientVariation: number | null;
    momentumSlope: number | null;
  }

  const raws: Raw[] = [];

  for (const [accountId, orders] of ordersByAccount) {
    if (orders.length === 0) continue;
    const last = orders[orders.length - 1];
    const daysSinceLastOrder = Math.round((asOf.getTime() - new Date(last.date).getTime()) / 86400000);

    const orders12m = orders.filter((o) => o.date >= cutoff12mStr && o.date <= asOfStr);
    const totalValue12m = orders12m.reduce((s, o) => s + o.value, 0);

    let coefficientVariation: number | null = null;
    if (orders.length >= 3) {
      const intervals: number[] = [];
      for (let i = 1; i < orders.length; i++) {
        intervals.push((new Date(orders[i].date).getTime() - new Date(orders[i - 1].date).getTime()) / 86400000);
      }
      const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
      if (mean > 0) {
        const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
        coefficientVariation = Math.sqrt(variance) / mean;
      }
    }

    let momentumSlope: number | null = null;
    const last6 = orders.slice(-6);
    if (last6.length >= 3) {
      const points = last6.map((o, i) => ({ x: i, y: o.value }));
      momentumSlope = linearRegressionSlope(points);
    }

    raws.push({
      accountId,
      daysSinceLastOrder,
      orderCount12m: orders12m.length,
      totalValue12m,
      coefficientVariation,
      momentumSlope,
    });
  }

  // Distributions de population pour les rangs percentile
  const daysPopulation = raws.map((r) => r.daysSinceLastOrder).filter((v): v is number => v !== null);
  const freqPopulation = raws.map((r) => r.orderCount12m);
  const valuePopulation = raws.map((r) => r.totalValue12m).filter((v) => v > 0);
  const cvPopulation = raws.map((r) => r.coefficientVariation).filter((v): v is number => v !== null);
  const momentumPopulation = raws.map((r) => r.momentumSlope).filter((v): v is number => v !== null);

  return raws.map((r) => {
    // Récence : percentile de -daysSinceLastOrder (moins de jours = mieux classé)
    const recence =
      r.daysSinceLastOrder === null ? null : 100 - percentileRank(daysPopulation, r.daysSinceLastOrder);
    const frequence = percentileRank(freqPopulation, r.orderCount12m);
    const monetaire = r.totalValue12m > 0 ? percentileRank(valuePopulation, r.totalValue12m) : 0;
    // Stabilité : percentile de -CV (CV faible = régulier = mieux classé)
    const stabilite = r.coefficientVariation === null ? null : 100 - percentileRank(cvPopulation, r.coefficientVariation);
    const momentum = r.momentumSlope === null ? null : percentileRank(momentumPopulation, r.momentumSlope);

    const sub: RfmsSubScores = { recence, frequence, monetaire, stabilite, momentum };

    const available = Object.entries(sub).filter(([, v]) => v !== null) as [keyof RfmsSubScores, number][];
    const weightSum = available.reduce((s, [k]) => s + WEIGHTS[k], 0);
    const sonarScore =
      available.length === 0
        ? null
        : Math.round(available.reduce((s, [k, v]) => s + v * WEIGHTS[k], 0) / weightSum);

    return {
      accountId: r.accountId,
      sub,
      sonarScore,
      orderCount12m: r.orderCount12m,
      totalValue12m: r.totalValue12m,
      daysSinceLastOrder: r.daysSinceLastOrder,
      coefficientVariation: r.coefficientVariation,
    };
  });
}

export type SonarTier = "tier_1" | "tier_2" | "tier_3" | "tier_4";

export const TIER_META: Record<SonarTier, { label: string; percentile: string }> = {
  tier_1: { label: "Tier 1", percentile: "Top 10%" },
  tier_2: { label: "Tier 2", percentile: "10-30%" },
  tier_3: { label: "Tier 3", percentile: "30-60%" },
  tier_4: { label: "Tier 4", percentile: "60% restants" },
};

/**
 * Tiers en percentile de la population scorée (pas en seuil absolu) —
 * corrige le biais mesuré par le backtest utilisateur (Tier 1 à seuil fixe
 * convertissant moins bien que Tier 2 : 26,4% vs 30,5%, trop peu de
 * comptes dépassant réellement le seuil sur une distribution nationale).
 */
export function assignSonarTiers(results: AccountRfmsResult[]): Map<string, SonarTier> {
  const scored = results
    .filter((r) => r.sonarScore !== null)
    .sort((a, b) => (b.sonarScore ?? 0) - (a.sonarScore ?? 0));
  const n = scored.length;
  const tiers = new Map<string, SonarTier>();
  scored.forEach((r, i) => {
    const pct = n <= 1 ? 0 : i / n;
    const tier: SonarTier = pct < 0.1 ? "tier_1" : pct < 0.3 ? "tier_2" : pct < 0.6 ? "tier_3" : "tier_4";
    tiers.set(r.accountId, tier);
  });
  return tiers;
}
