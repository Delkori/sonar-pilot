import type { Account } from "@/types/database";
import { PRIX_MOYEN_BOITE, computeTargetingScore } from "./scoring";
import { recurrenceBucket, isProspect } from "./accounts";
import type { RecurrenceBucket } from "./accounts";

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

/**
 * Répartit le prévisionnel d'un compte sur ses médecins, uniquement parmi
 * ceux dont le potentiel est renseigné — sans base réelle, un médecin
 * n'obtient ni une part fantôme (arrondie à 0), ni une part inventée : il
 * n'apparaît simplement pas dans la répartition. Les boîtes entières sont
 * réparties par la méthode du plus grand reste pour que la somme reste
 * exacte, sans qu'aucun médecin retenu ne se retrouve à 0 par arrondi.
 */
export function allocateToHcps(hcps: HcpLite[], boites: number, ca: number): HcpShare[] {
  const eligible = hcps.filter((h) => (h.potentiel_boites ?? 0) > 0);
  if (eligible.length === 0 || boites <= 0) return [];

  const totalPot = eligible.reduce((s, h) => s + (h.potentiel_boites ?? 0), 0);
  const shares = eligible.map((h) => (h.potentiel_boites ?? 0) / totalPot);
  const exactBoites = shares.map((s) => boites * s);
  const floors = exactBoites.map((v) => Math.floor(v));
  const remainder = boites - floors.reduce((s, v) => s + v, 0);

  const byRemainder = floors
    .map((_, i) => ({ i, frac: exactBoites[i] - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const finalBoites = [...floors];
  for (let k = 0; k < remainder && k < byRemainder.length; k++) finalBoites[byRemainder[k].i] += 1;

  return eligible
    .map((h, i) => ({
      hcpId: h.id,
      name: h.name,
      boites: finalBoites[i],
      ca: Math.round(ca * shares[i]),
    }))
    .filter((h) => h.boites > 0)
    .sort((a, b) => b.ca - a.ca)
    .slice(0, 3);
}

// Nombre de mois attendu entre deux commandes selon la cadence observée du
// compte — sert à décider si le mois cible "tombe" dans son rythme habituel.
const RECURRENCE_GAP_MONTHS: Record<RecurrenceBucket, number | null> = {
  Mensuelle: 1,
  Bimestrielle: 2,
  Trimestrielle: 3,
  Espacée: 6,
  Unique: null,
};

const SILENCE_MODERE_SEMAINES = 8;

interface MonthSignal {
  weight: number;
  reason: string;
}

function monthIndex(year: number, month: number): number {
  return year * 12 + month;
}

function orderedMonthIndices(sales: MonthlySaleRow[]): number[] {
  return sales
    .filter((s) => s.ca > 0)
    .map((s) => monthIndex(s.year, s.month))
    .sort((a, b) => a - b);
}

/**
 * Décide si un compte mérite une prévision sur un mois donné, et avec quel
 * poids — selon des critères de récurrence réels plutôt qu'un lissage
 * générique :
 *  1. Le mois cible tombe dans le rythme de commande habituel du compte
 *     (mensuel/bimestriel/trimestriel) → poids plein.
 *  2. Le compte n'a pas commandé le mois précédent cette année, mais
 *     commandait déjà ce même mois calendaire l'an dernier → relance
 *     saisonnière, poids modéré (retard probable, pas un vrai silence).
 *  3. Silence prolongé (≥ 8 semaines) sur un compte déjà actif (pas un pur
 *     prospect) → relance possible mais poids modéré, pour ne pas sur-prédire.
 *  4. Prospect sans historique réel → poids volontairement léger.
 * Sinon, aucune prévision n'est générée pour ce mois : mieux vaut un tableau
 * plus court mais fiable qu'une prévision sur chaque médecin par défaut.
 */
function evaluateMonthSignal(account: Account, orderedMonths: number[], tmIdx: number): MonthSignal | null {
  // Une commande réelle existe déjà ce mois-ci : le réalisé suffit, inutile
  // de la doubler d'une prévision.
  if (orderedMonths.includes(tmIdx)) return null;

  const lastOrderIdx = orderedMonths.length > 0 ? orderedMonths[orderedMonths.length - 1] : null;
  const bucket = recurrenceBucket(orderedMonths);
  const expectedGap = RECURRENCE_GAP_MONTHS[bucket];

  if (lastOrderIdx !== null && expectedGap !== null && tmIdx - lastOrderIdx >= expectedGap) {
    return { weight: 1, reason: `Récurrence ${bucket.toLowerCase()} — dû ce mois-ci` };
  }

  const sameMonthLastYear = tmIdx - 12;
  const prevMonthThisYear = tmIdx - 1;
  if (orderedMonths.includes(sameMonthLastYear) && !orderedMonths.includes(prevMonthThisYear)) {
    return { weight: 0.7, reason: "Relance saisonnière — commandait ce mois-ci l'an dernier" };
  }

  const prospect = isProspect(account);
  const silenceWeeks = account.jours_silence != null ? account.jours_silence / 7 : null;
  if (!prospect && silenceWeeks !== null && silenceWeeks >= SILENCE_MODERE_SEMAINES) {
    return { weight: 0.45, reason: `Silence prolongé (${Math.round(silenceWeeks)} sem.) — relance modérée` };
  }

  if (prospect) {
    const score = computeTargetingScore(account);
    if (score.action !== "fideliser") {
      return { weight: 0.3, reason: "Prospect à développer — montant volontairement prudent" };
    }
  }

  return null;
}

/**
 * Prévision mensuelle prédictive pour un compte, mois par mois : chaque mois
 * cible est évalué indépendamment (récurrence, relance saisonnière, silence,
 * prospect) et n'apparaît que s'il y a un signal réel — voir
 * `evaluateMonthSignal`. Le montant est plafonné au potentiel du compte et
 * réparti par médecin au prorata de leur potentiel.
 */
export function predictMonthlyForecast(
  account: Account,
  hcps: HcpLite[],
  sales: MonthlySaleRow[],
  targetMonths: { year: number; month: number }[]
): PredictedForecast[] {
  const orderedMonths = orderedMonthIndices(sales);
  const potentielAnnual = (account.potentiel_boites ?? 0) * PRIX_MOYEN_BOITE;
  const runRate = [...sales]
    .sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month))
    .slice(0, 12)
    .reduce((s, r) => s + r.ca, 0);
  const baselineMonthly = potentielAnnual > 0 ? potentielAnnual / 12 : runRate > 0 ? runRate / 12 : 0;
  const caParBoite =
    account.realise_boites && account.realise_boites > 0 && account.ca_2026_ytd
      ? account.ca_2026_ytd / account.realise_boites
      : PRIX_MOYEN_BOITE;

  const out: PredictedForecast[] = [];
  for (const tm of targetMonths) {
    const tmIdx = monthIndex(tm.year, tm.month);
    const signal = evaluateMonthSignal(account, orderedMonths, tmIdx);
    if (!signal) continue;
    const ca = Math.round(baselineMonthly * signal.weight);
    if (ca <= 0) continue;
    const boites = caParBoite > 0 ? Math.round(ca / caParBoite) : 0;
    out.push({
      account_id: account.id,
      year: tm.year,
      month: tm.month,
      ca_prevu: ca,
      boites_prevues: boites,
      note: signal.reason,
      hcp: allocateToHcps(hcps, boites, ca),
    });
  }
  return out;
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
