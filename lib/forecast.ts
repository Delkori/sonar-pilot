import type { Account } from "@/types/database";
import { PRIX_MOYEN_BOITE, computeTargetingScore, ACTION_META } from "./scoring";
import type { ActionCode } from "./scoring";

export interface SuggestedForecast {
  year: number;
  month: number;
  boites_prevues: number;
  ca_prevu: number;
  note: string;
}

/**
 * Propose une répartition mensuelle basée sur les vraies données du compte :
 * - part de l'objectif Q3 restant à faire, répartie sur les mois cibles
 * - poids par mois ajusté selon le score (plus le score est mauvais, plus la
 *   relance est priorisée tôt) et le silence (compte silencieux = démarrage
 *   plus lent, effort concentré en fin de période)
 * - CA prévu dérivé du CA réel par boîte déjà observé (ca_2026_ytd /
 *   realise_boites), ou à défaut du CA 2025 rapporté à l'objectif
 *
 * C'est une proposition de départ, pas une vérité — chaque valeur reste
 * éditable ou supprimable une fois insérée.
 */
export function suggestMonthlyForecast(
  account: Account,
  targetMonths: { year: number; month: number }[]
): SuggestedForecast[] {
  const restant = Math.max((account.objectif_boites ?? 0) - (account.realise_boites ?? 0), 0);

  // Poids simple : plus de poids sur les mois suivants si le compte est
  // silencieux (temps de relance avant que ça reparte), poids égal sinon.
  const silence = account.jours_silence ?? 0;
  const rawWeights = targetMonths.map((_, i) => (silence > 60 ? i + 1 : 1));
  const weightSum = rawWeights.reduce((s, w) => s + w, 0) || 1;

  const caParBoite =
    account.realise_boites && account.realise_boites > 0 && account.ca_2026_ytd
      ? account.ca_2026_ytd / account.realise_boites
      : account.objectif_boites && account.objectif_boites > 0 && account.ca_2025
      ? account.ca_2025 / account.objectif_boites
      : 0;

  return targetMonths.map((tm, i) => {
    const boites = Math.round((restant * rawWeights[i]) / weightSum);
    return {
      year: tm.year,
      month: tm.month,
      boites_prevues: boites,
      ca_prevu: Math.round(boites * caParBoite),
      note: restant > 0 ? "Proposition automatique — à ajuster" : "Objectif déjà atteint, maintien du rythme",
    };
  });
}

export interface MonthlySaleRow {
  account_id: string;
  year: number;
  month: number;
  ca: number;
}

// ── Modèle prédictif v2 ──────────────────────────────────────────────────
// Objectif : une prévision réaliste, ancrée sur le vrai rythme de commandes
// (run-rate) plutôt que sur l'objectif souvent vide, avec une répartition
// par médecin (HCP) et un plafond au potentiel du compte.

export interface HcpLite {
  id: string;
  name: string;
  potentiel_boites: number | null;
}

export interface HcpShare {
  hcpId: string;
  name: string;
  boites: number;
  ca: number;
}

export interface PredictedForecast {
  account_id: string;
  year: number;
  month: number;
  boites_prevues: number;
  ca_prevu: number;
  note: string;
  /** Répartition de la prévision du mois sur les médecins du compte. */
  hcp: HcpShare[];
}

// Facteur de croissance appliqué au run-rate selon l'action recommandée :
// un compte à conquérir/développer a plus d'upside qu'un compte déjà fidèle.
// Facteurs volontairement prudents : on part du rythme réel de commandes
// (run-rate) et on n'ajoute qu'une croissance modérée selon l'action. Objectif :
// un prévisionnel crédible, pas gonflé.
const GROWTH_BY_ACTION: Record<ActionCode, number> = {
  visite_urgente: 1.15,
  developper_pdm: 1.12,
  reconquete: 1.1,
  cross_sell: 1.08,
  relance: 1.05,
  fideliser: 1.0,
};

export function allocateToHcps(hcps: HcpLite[], boites: number, ca: number): HcpShare[] {
  if (hcps.length === 0) return [];
  const totalPot = hcps.reduce((s, h) => s + (h.potentiel_boites ?? 0), 0);
  return hcps.map((h) => {
    const share = totalPot > 0 ? (h.potentiel_boites ?? 0) / totalPot : 1 / hcps.length;
    return { hcpId: h.id, name: h.name, boites: Math.round(boites * share), ca: Math.round(ca * share) };
  });
}

/**
 * Prévision mensuelle prédictive pour un compte :
 *  - base = run-rate annuel réel (somme des 12 derniers mois de commandes),
 *    à défaut CA 2026 annualisé, à défaut CA 2025 ; un prospect sans
 *    historique est amorcé sur 20 % de son potentiel ;
 *  - amplifiée par un facteur de croissance selon l'action recommandée ;
 *  - plafonnée à 110 % du potentiel annuel (on ne prévoit pas l'impossible) ;
 *  - répartie sur les mois cibles selon la saisonnalité observée (lissée),
 *    puis éclatée par médecin au prorata de leur potentiel.
 */
export function predictMonthlyForecast(
  account: Account,
  hcps: HcpLite[],
  sales: MonthlySaleRow[],
  targetMonths: { year: number; month: number }[]
): PredictedForecast[] {
  const score = computeTargetingScore(account);
  const growth = GROWTH_BY_ACTION[score.action];

  const monthlyTotals = new Array(12).fill(0) as number[];
  for (const s of sales) monthlyTotals[s.month - 1] += s.ca;

  const runRate = [...sales]
    .sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month))
    .slice(0, 12)
    .reduce((s, r) => s + r.ca, 0);

  const monthsElapsed = new Date().getMonth() + 1;
  let baseAnnual =
    runRate > 0
      ? runRate
      : account.ca_2026_ytd && account.ca_2026_ytd > 0
      ? account.ca_2026_ytd * (12 / monthsElapsed)
      : account.ca_2025 ?? 0;

  const potentielAnnual = (account.potentiel_boites ?? 0) * PRIX_MOYEN_BOITE;
  // Prospect sans historique : amorce sur une petite fraction du potentiel.
  if (baseAnnual === 0 && potentielAnnual > 0) baseAnnual = potentielAnnual * 0.1;

  let projectedAnnual = baseAnnual * growth;
  // Plafond prudent : on ne prévoit pas plus que ~50 % du potentiel annuel,
  // tout en ne coupant jamais sous le rythme réel déjà observé (+30 % max).
  if (potentielAnnual > 0) {
    const plafond = Math.max(runRate * 1.3, potentielAnnual * 0.5);
    projectedAnnual = Math.min(projectedAnnual, plafond);
  }

  const caParBoite =
    account.realise_boites && account.realise_boites > 0 && account.ca_2026_ytd
      ? account.ca_2026_ytd / account.realise_boites
      : PRIX_MOYEN_BOITE;

  const seasonalSum = monthlyTotals.reduce((s, v) => s + v, 0);

  return targetMonths.map((tm) => {
    // poids saisonnier lissé (60 % saisonnalité réelle, 40 % uniforme) pour
    // éviter qu'un mois jamais commandé tombe à zéro
    const weight =
      seasonalSum > 0 ? 0.6 * (monthlyTotals[tm.month - 1] / seasonalSum) + 0.4 * (1 / 12) : 1 / 12;
    const ca = Math.round(projectedAnnual * weight);
    const boites = caParBoite > 0 ? Math.round(ca / caParBoite) : 0;
    return {
      account_id: account.id,
      year: tm.year,
      month: tm.month,
      ca_prevu: ca,
      boites_prevues: boites,
      note: `${ACTION_META[score.action].label} — prévision IA (run-rate ${Math.round(baseAnnual).toLocaleString("fr-FR")} €/an ×${growth})`,
      hcp: allocateToHcps(hcps, boites, ca),
    };
  });
}

/**
 * Applique le modèle prédictif à tout le portefeuille, en sautant les
 * comptes "lost", ceux dont la prévision ressort à 0 sur toute la période,
 * et les mois déjà renseignés (jamais d'écrasement).
 */
export function predictPortfolioForecast(
  accounts: Account[],
  hcpsByAccount: Map<string, HcpLite[]>,
  sales: MonthlySaleRow[],
  existing: { account_id: string; year: number; month: number }[],
  targetMonths: { year: number; month: number }[]
): PredictedForecast[] {
  const salesByAccount = new Map<string, MonthlySaleRow[]>();
  for (const s of sales) {
    const arr = salesByAccount.get(s.account_id);
    if (arr) arr.push(s);
    else salesByAccount.set(s.account_id, [s]);
  }
  const existingKey = new Set(existing.map((f) => `${f.account_id}-${f.year}-${f.month}`));

  const out: PredictedForecast[] = [];
  for (const account of accounts) {
    if (account.status === "lost") continue;
    const remaining = targetMonths.filter((tm) => !existingKey.has(`${account.id}-${tm.year}-${tm.month}`));
    if (remaining.length === 0) continue;

    const preds = predictMonthlyForecast(
      account,
      hcpsByAccount.get(account.id) ?? [],
      salesByAccount.get(account.id) ?? [],
      remaining
    );
    if (preds.every((p) => p.ca_prevu === 0)) continue;
    out.push(...preds);
  }
  return out;
}

/**
 * Remplissage automatique du prévisionnel pour tout le portefeuille.
 * Deux signaux, dans cet ordre de priorité par compte :
 *  1. Saisonnalité réelle observée dans account_monthly_sales (>= 3 mois
 *     avec du CA) : le CA à faire est réparti sur les mois cibles au
 *     prorata du poids historique de chaque mois calendaire — le signal
 *     le plus fiable puisqu'il vient des commandes déjà passées.
 *  2. Sinon (compte trop récent / prospect sans historique), retombe sur
 *     la pondération silence/score de suggestMonthlyForecast.
 * Exclut les comptes "lost", ceux déjà à l'objectif sans potentiel
 * résiduel, et n'écrit jamais sur un mois déjà prévisionné.
 */
export function autoFillPortfolioForecast(
  accounts: Account[],
  monthlySales: MonthlySaleRow[],
  existingForecasts: { account_id: string; year: number; month: number }[],
  targetMonths: { year: number; month: number }[]
): (SuggestedForecast & { account_id: string })[] {
  const salesByAccount = new Map<string, MonthlySaleRow[]>();
  for (const s of monthlySales) {
    if (!salesByAccount.has(s.account_id)) salesByAccount.set(s.account_id, []);
    salesByAccount.get(s.account_id)!.push(s);
  }
  const existingKey = new Set(existingForecasts.map((f) => `${f.account_id}-${f.year}-${f.month}`));

  const results: (SuggestedForecast & { account_id: string })[] = [];

  for (const account of accounts) {
    if (account.status === "lost") continue;

    const score = computeTargetingScore(account);
    const restant = Math.max((account.objectif_boites ?? 0) - (account.realise_boites ?? 0), 0);
    const potentielRestant = Math.max((account.potentiel_boites ?? 0) - (account.realise_boites ?? 0), 0);
    if (restant <= 0 && potentielRestant <= 0 && score.action === "fideliser") continue;

    const remainingTargets = targetMonths.filter((tm) => !existingKey.has(`${account.id}-${tm.year}-${tm.month}`));
    if (remainingTargets.length === 0) continue;

    const history = salesByAccount.get(account.id) ?? [];
    const monthlyTotals = new Array(12).fill(0) as number[];
    for (const h of history) monthlyTotals[h.month - 1] += h.ca;
    const historyPoints = history.filter((h) => h.ca > 0).length;

    const objectifCa =
      restant > 0 && (account.objectif_boites ?? 0) > 0 && account.ca_2025
        ? (account.ca_2025 / account.objectif_boites!) * restant
        : potentielRestant * PRIX_MOYEN_BOITE;

    if (historyPoints >= 3 && objectifCa > 0) {
      const caParBoite =
        account.realise_boites && account.realise_boites > 0 && account.ca_2026_ytd
          ? account.ca_2026_ytd / account.realise_boites
          : PRIX_MOYEN_BOITE;
      const sum = monthlyTotals.reduce((s, v) => s + v, 0) || 1;
      for (const tm of remainingTargets) {
        const weight = monthlyTotals[tm.month - 1] / sum;
        const ca = Math.round(objectifCa * weight);
        results.push({
          account_id: account.id,
          year: tm.year,
          month: tm.month,
          ca_prevu: ca,
          boites_prevues: caParBoite > 0 ? Math.round(ca / caParBoite) : 0,
          note: "Auto — saisonnalité observée sur l'historique de commandes",
        });
      }
    } else {
      const suggestions = suggestMonthlyForecast(account, remainingTargets);
      for (const s of suggestions) {
        results.push({ account_id: account.id, ...s, note: "Auto — objectif restant pondéré par silence/score" });
      }
    }
  }

  return results;
}
