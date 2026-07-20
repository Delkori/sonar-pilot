import type { Account } from "@/types/database";

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
