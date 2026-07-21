import type { Account } from "@/types/database";
import { PRIX_MOYEN_BOITE, computeTargetingScore } from "./scoring";

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
