import type { Account, SectorObjective } from "@/types/database";
import { prixBoiteHT, computeTargetingScore } from "./scoring";
import { recurrenceBucket, isProspect } from "./accounts";
import type { RecurrenceBucket } from "./accounts";
import { computeBrandVelocities } from "./sonarscore/velocity";
import type { PurchaseLine } from "./sonarscore/velocity";
import { predictNextOrders } from "./sonarscore/prediction";
import type { AccountBrandPrediction } from "./sonarscore/prediction";

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
// compte — sert à décider si le mois cible "tombe" dans son rythme habituel,
// et surtout comme ESPACEMENT MINIMUM entre deux mois prévus : un compte qui
// vient de commander a besoin de ce délai pour écouler son stock avant d'être
// re-sollicité, même si l'objectif restant est encore loin d'être atteint.
const RECURRENCE_GAP_MONTHS: Record<RecurrenceBucket, number | null> = {
  Mensuelle: 1,
  Bimestrielle: 2,
  Trimestrielle: 3,
  Espacée: 6,
  Unique: null,
};
// Écart par défaut quand la cadence est inconnue/unique — mieux vaut espacer
// prudemment que de proposer deux mois consécutifs à un compte trop rare.
const GAP_MOIS_PAR_DEFAUT = 3;

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

function monthIndexFromDateStr(dateStr: string): number {
  const d = new Date(dateStr);
  return monthIndex(d.getFullYear(), d.getMonth() + 1);
}

/**
 * Signal "réappro produit attendu" — repose sur `sonarscore/prediction.ts`
 * (déjà validé côté SonarScore) : pour chaque marque du compte, la prochaine
 * date de commande probable, au rythme PROPRE du compte sur cette marque
 * quand il y a assez d'historique, avec repli sur la vélocité de la marque
 * (population) pour un essai unique. Plus précis que la récurrence agrégée
 * toutes marques confondues ci-dessous (RHA4 tous les 2 mois et RHA3 tous
 * les 6 mois sont deux rythmes différents, noyés si on ne regarde que le
 * total du compte) — prioritaire quand disponible.
 */
function productMonthSignal(predictions: AccountBrandPrediction[], tmIdx: number): MonthSignal | null {
  const matches = predictions.filter(
    (p) => p.expectedNextOrderDate !== null && monthIndexFromDateStr(p.expectedNextOrderDate) === tmIdx
  );
  if (matches.length === 0) return null;

  // Priorité à la meilleure confiance dispo (rythme propre au compte avant
  // repli population).
  matches.sort((a, b) => (a.confidence === "compte" ? 0 : 1) - (b.confidence === "compte" ? 0 : 1));
  const best = matches[0];
  const weight = best.confidence === "compte" ? 1 : 0.6;
  const reason =
    matches.length === 1
      ? `${best.brand} attendu ce mois-ci (${best.confidence === "compte" ? "rythme propre au compte" : "vélocité de la marque"})`
      : `${matches.map((m) => m.brand).join(", ")} attendus ce mois-ci`;
  return { weight, reason };
}

/**
 * Décide si un compte mérite une prévision sur un mois donné, et avec quel
 * poids — selon des critères de récurrence réels plutôt qu'un lissage
 * générique :
 *  0. Une marque précise du compte a une date de réappro attendue ce
 *     mois-ci (`productMonthSignal`, ci-dessus) → signal le plus précis
 *     disponible, prioritaire sur tout le reste.
 *  1. Sinon, le mois cible tombe dans le rythme de commande habituel du
 *     compte toutes marques confondues (mensuel/bimestriel/trimestriel),
 *     avec un retard modéré (moins de 2 cycles) → poids plein. Au-delà, la
 *     confiance décroît avec le nombre de cycles manqués : un compte en
 *     retard de 25 mois sur un rythme trimestriel n'est plus "dû ce
 *     mois-ci" avec la même certitude qu'un compte en retard de 3 mois —
 *     c'est un compte qu'il faut re-conquérir, pas relancer sur son rythme
 *     habituel.
 *  2. Le compte n'a pas commandé le mois précédent cette année, mais
 *     commandait déjà ce même mois calendaire l'an dernier → relance
 *     saisonnière, poids modéré (retard probable, pas un vrai silence).
 *  3. Silence prolongé (≥ 8 semaines) sur un compte déjà actif (pas un pur
 *     prospect) → relance possible mais poids modéré, pour ne pas sur-prédire.
 *  4. Prospect sans historique réel → poids volontairement léger.
 * Sinon, aucune prévision n'est générée pour ce mois : mieux vaut un tableau
 * plus court mais fiable qu'une prévision sur chaque médecin par défaut.
 */
function evaluateMonthSignal(
  account: Account,
  orderedMonths: number[],
  tmIdx: number,
  brandPredictions: AccountBrandPrediction[]
): MonthSignal | null {
  // Une commande réelle existe déjà ce mois-ci : le réalisé suffit, inutile
  // de la doubler d'une prévision.
  if (orderedMonths.includes(tmIdx)) return null;

  const productSignal = productMonthSignal(brandPredictions, tmIdx);
  if (productSignal) return productSignal;

  const lastOrderIdx = orderedMonths.length > 0 ? orderedMonths[orderedMonths.length - 1] : null;
  const bucket = recurrenceBucket(orderedMonths);
  const expectedGap = RECURRENCE_GAP_MONTHS[bucket];

  if (lastOrderIdx !== null && expectedGap !== null) {
    const overdue = tmIdx - lastOrderIdx;
    if (overdue >= expectedGap && overdue < expectedGap * 2) {
      return { weight: 1, reason: `Récurrence ${bucket.toLowerCase()} — dû ce mois-ci` };
    }
    if (overdue >= expectedGap * 2) {
      const cyclesMissed = Math.floor(overdue / expectedGap);
      const weight = Math.max(0.15, 1 / cyclesMissed);
      return {
        weight,
        reason: `Rythme ${bucket.toLowerCase()} dépassé depuis longtemps (${cyclesMissed} cycles manqués) — relance prudente`,
      };
    }
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

export interface ExistingForecastEntry {
  account_id: string;
  year: number;
  month: number;
  boites_prevues: number | null;
  ca_prevu: number | null;
  source: "auto" | "manuel";
}

/**
 * Prévision mensuelle prédictive pour un compte — modèle "top-down" : on part
 * de l'objectif restant à faire (objectif_boites − réalisé ; à défaut, le
 * potentiel du compte sert d'objectif implicite), et on le répartit sur les
 * mois qui ont un signal réel (récurrence, relance saisonnière, silence,
 * prospect — voir `evaluateMonthSignal`), au prorata du poids de chaque
 * signal. Résultat : la somme des mois générés correspond exactement à ce
 * qu'il reste à faire, au lieu d'un montant mensuel déconnecté de l'objectif.
 *
 * Les mois déjà saisis à la main (`source: 'manuel'`) sont exclus de la
 * répartition et leurs boîtes sont déduites du restant à répartir — l'IA
 * complète autour de ce que l'utilisateur a déjà décidé, elle ne le double
 * pas.
 */
// Facteur de croissance prudent appliqué au run-rate réel pour projeter une
// cible annuelle implicite — jamais la promesse de capter le potentiel entier
// d'un coup.
const CROISSANCE_PRUDENTE = 1.15;
// Un compte sans aucun historique de commande ne peut pas se voir prédire une
// part du potentiel : seule une commande d'amorçage est réaliste.
const PART_AMORCAGE_PROSPECT = 0.05;
// En dessous de ce seuil, la commande ne justifie pas le déplacement/l'effort
// commercial : mieux vaut ne rien proposer ce mois-là que de suggérer un
// passage pour 1-2 boîtes.
const MIN_BOITES_RENTABLE = 5;

const COMMANDES_PAR_AN: Record<RecurrenceBucket, number> = {
  Mensuelle: 12,
  Bimestrielle: 6,
  Trimestrielle: 4,
  Espacée: 2,
  Unique: 1,
};

// Tier de contrat → confiance sur la capacité du compte à absorber la
// croissance projetée (un Pro+ a déjà prouvé un volume plus soutenu).
const TIER_FACTOR: Record<string, number> = { Premium: 0.9, Pro: 1.0, "Pro+": 1.15 };

/**
 * Facteur de tendance : compare l'activité des 6 derniers mois à celle des 6
 * mois précédents (nombre de commandes, comme proxy simple et robuste au
 * bruit du montant unitaire). Un compte qui accélère justifie une cible plus
 * ambitieuse ; un compte qui ralentit, une cible plus prudente. Neutre (1)
 * dès qu'il n'y a pas assez d'historique récent pour juger.
 */
function trendFactor(orderedMonths: number[], nowIdx: number): number {
  const recent = orderedMonths.filter((m) => m > nowIdx - 6 && m <= nowIdx).length;
  const previous = orderedMonths.filter((m) => m > nowIdx - 12 && m <= nowIdx - 6).length;
  if (recent === 0 && previous === 0) return 1;
  if (previous === 0) return recent > 0 ? 1.2 : 1;
  const ratio = recent / previous;
  return Math.min(1.3, Math.max(0.7, ratio));
}

/**
 * Cible annuelle implicite quand aucun objectif n'est saisi — jamais le
 * potentiel brut (taille de marché théorique sur 1 an), mais une projection
 * du run-rate réellement observé (CA historique moyen par commande × cadence
 * de commande de l'année), ajustée par la tendance récente et le tier de
 * contrat, plafonnée par le potentiel. Un compte sans aucune commande passée
 * reçoit une cible d'amorçage minime (quelques % du potentiel), pas un
 * objectif calqué sur un client qui achèterait déjà à pleine capacité.
 */
function implicitTargetBoites(
  account: Account,
  orderedMonths: number[],
  sales: MonthlySaleRow[],
  caParBoite: number,
  nowIdx: number
): number {
  const potentielBoites = account.potentiel_boites ?? 0;
  if (orderedMonths.length === 0 || caParBoite <= 0) {
    return Math.round(potentielBoites * PART_AMORCAGE_PROSPECT);
  }

  const totalCaHistorique = sales.filter((s) => s.ca > 0).reduce((s, v) => s + v.ca, 0);
  const avgOrderBoites = totalCaHistorique / orderedMonths.length / caParBoite;
  const bucket = recurrenceBucket(orderedMonths);
  const tierAdj = TIER_FACTOR[account.price_list ?? ""] ?? 1;
  const trendAdj = trendFactor(orderedMonths, nowIdx);
  const runRateAnnuel = avgOrderBoites * COMMANDES_PAR_AN[bucket] * CROISSANCE_PRUDENTE * tierAdj * trendAdj;

  return potentielBoites > 0 ? Math.min(Math.round(runRateAnnuel), potentielBoites) : Math.round(runRateAnnuel);
}

/**
 * Taille réaliste d'UNE commande pour ce compte — le CA historique moyen par
 * commande, ajusté par la tendance et le tier, jamais le restant divisé par
 * le nombre de mois éligibles. C'est ce montant (borné par ce qu'il reste à
 * faire) qui est proposé à chaque mois retenu, pas plus : un compte ne
 * commande jamais "tout ce qu'il reste à faire sur l'année" en une fois.
 */
function typicalOrderBoites(
  orderedMonths: number[],
  sales: MonthlySaleRow[],
  caParBoite: number,
  potentielBoites: number,
  tierAdj: number,
  trendAdj: number
): number {
  if (orderedMonths.length === 0 || caParBoite <= 0) {
    return Math.max(1, Math.round(potentielBoites * PART_AMORCAGE_PROSPECT));
  }
  const totalCaHistorique = sales.filter((s) => s.ca > 0).reduce((s, v) => s + v.ca, 0);
  const avgOrderBoites = totalCaHistorique / orderedMonths.length / caParBoite;
  return Math.max(1, Math.round(avgOrderBoites * CROISSANCE_PRUDENTE * tierAdj * trendAdj));
}

export function predictMonthlyForecast(
  account: Account,
  hcps: HcpLite[],
  sales: MonthlySaleRow[],
  targetMonths: { year: number; month: number }[],
  existingForAccount: ExistingForecastEntry[] = [],
  brandPredictions: AccountBrandPrediction[] = []
): PredictedForecast[] {
  const orderedMonths = orderedMonthIndices(sales);

  const objectifBoites = account.objectif_boites ?? 0;
  const caParBoiteForTarget =
    account.realise_boites && account.realise_boites > 0 && account.ca_2026_ytd
      ? account.ca_2026_ytd / account.realise_boites
      : prixBoiteHT(account.price_list);
  const now = new Date();
  const nowIdx = monthIndex(now.getFullYear(), now.getMonth() + 1);
  const cibleBoites =
    objectifBoites > 0
      ? objectifBoites
      : implicitTargetBoites(account, orderedMonths, sales, caParBoiteForTarget, nowIdx);

  const manuelBoitesSum = existingForAccount
    .filter((e) => e.source === "manuel")
    .reduce((s, e) => s + (e.boites_prevues ?? 0), 0);
  const manuelMonthKeys = new Set(
    existingForAccount.filter((e) => e.source === "manuel").map((e) => monthIndex(e.year, e.month))
  );

  let restantLeft = Math.max(cibleBoites - (account.realise_boites ?? 0) - manuelBoitesSum, 0);
  if (restantLeft <= 0) return [];

  const caParBoite =
    account.realise_boites && account.realise_boites > 0 && account.ca_2026_ytd
      ? account.ca_2026_ytd / account.realise_boites
      : prixBoiteHT(account.price_list);

  const tierAdj = TIER_FACTOR[account.price_list ?? ""] ?? 1;
  const trendAdj = trendFactor(orderedMonths, nowIdx);
  const typicalOrder = typicalOrderBoites(
    orderedMonths,
    sales,
    caParBoite,
    account.potentiel_boites ?? 0,
    tierAdj,
    trendAdj
  );

  const bucket = recurrenceBucket(orderedMonths);
  const minGapMonths = RECURRENCE_GAP_MONTHS[bucket] ?? GAP_MOIS_PAR_DEFAUT;

  // Simulation mois par mois (chronologique) plutôt qu'une répartition
  // proportionnelle du restant : chaque mois retenu reçoit au plus une
  // commande de taille réaliste (`typicalOrder`), et un mois est ignoré s'il
  // tombe trop tôt après le dernier point de consommation du compte (vraie
  // commande, prévision déjà générée, ou saisie manuelle) — le temps que le
  // stock déjà livré soit écoulé avant de re-solliciter le compte.
  const manuelSorted = [...manuelMonthKeys].sort((a, b) => a - b);
  let manuelPtr = 0;
  let lastIdx = orderedMonths.length > 0 ? orderedMonths[orderedMonths.length - 1] : null;

  const sortedTargets = [...targetMonths].sort(
    (a, b) => monthIndex(a.year, a.month) - monthIndex(b.year, b.month)
  );

  const results: PredictedForecast[] = [];
  for (const tm of sortedTargets) {
    const tmIdx = monthIndex(tm.year, tm.month);

    while (manuelPtr < manuelSorted.length && manuelSorted[manuelPtr] < tmIdx) {
      if (lastIdx === null || manuelSorted[manuelPtr] > lastIdx) lastIdx = manuelSorted[manuelPtr];
      manuelPtr++;
    }

    if (manuelMonthKeys.has(tmIdx)) continue; // saisi à la main, jamais écrasé
    if (orderedMonths.includes(tmIdx)) continue; // commande réelle déjà là

    if (lastIdx !== null && tmIdx - lastIdx < minGapMonths) continue; // stock pas encore écoulé

    const signal = evaluateMonthSignal(account, orderedMonths, tmIdx, brandPredictions);
    if (!signal) continue;

    const boites = Math.min(Math.round(typicalOrder * signal.weight), restantLeft);
    // Pas rentable de proposer un passage pour une commande symbolique — on
    // saute ce mois plutôt que d'afficher un chiffre qui ne justifie pas
    // l'effort commercial.
    if (boites < MIN_BOITES_RENTABLE) continue;

    const ca = Math.round(boites * caParBoite);
    results.push({
      account_id: account.id,
      year: tm.year,
      month: tm.month,
      ca_prevu: ca,
      boites_prevues: boites,
      note: signal.reason,
      hcp: allocateToHcps(hcps, boites, ca),
    });

    restantLeft -= boites;
    lastIdx = tmIdx;
    if (restantLeft <= 0) break;
  }

  return results;
}

// ── Comblement de l'écart vs objectif secteur ────────────────────────────
// La génération de base (`predictMonthlyForecast`) est volontairement
// prudente compte par compte, et ignore l'objectif du secteur (`objectif_ca`
// par mois, saisi dans Paramètres) : rien ne garantit que la somme des
// prévisions atteigne ce total. Cette passe complémentaire ne remplace pas le
// modèle de base, elle intervient seulement si un écart subsiste : elle
// sollicite davantage les comptes qui ont encore de la marge, en assouplissant
// les seuils de prudence (montant minimum rentable, espacement entre
// commandes) — mais jamais le seul plafond qui reste dur : le potentiel réel
// du compte (`potentiel_boites`). On ne comble jamais un objectif secteur en
// inventant de la capacité de marché qui n'existe pas ; si la somme des
// potentiels du portefeuille est elle-même inférieure à l'objectif, l'écart
// restant est un signal réel (portefeuille trop petit / objectif trop
// ambitieux), pas un bug du générateur.
const TOP_UP_MIN_BOITES = 1;
// Espacement minimum réduit de moitié (arrondi au plancher, jamais < 1 mois)
// par rapport à la génération de base : on accepte de re-solliciter un compte
// un peu plus tôt pour combler l'objectif, sans le faire commander deux fois
// le même mois.
const TOP_UP_GAP_DIVISOR = 2;

/**
 * Complète en place (`out`) le prévisionnel déjà généré pour que le total par
 * mois se rapproche de l'objectif secteur, en répartissant l'écart sur les
 * comptes actifs qui ont encore du potentiel non consommé — priorité aux
 * comptes ayant la plus grande marge restante, pour combler l'écart avec le
 * moins de comptes forcés possible plutôt que de pousser chaque petit compte.
 */
function applySectorObjectiveTopUp(
  out: PredictedForecast[],
  accounts: Account[],
  hcpsByAccount: Map<string, HcpLite[]>,
  salesByAccount: Map<string, MonthlySaleRow[]>,
  existing: ExistingForecastEntry[],
  sectorObjectives: SectorObjective[],
  targetMonths: { year: number; month: number }[]
): void {
  if (sectorObjectives.length === 0) return;

  const monthKey = (y: number, m: number) => `${y}-${m}`;
  const plannedCaByMonth = new Map<string, number>();
  const plannedBoitesByAccountTotal = new Map<string, number>();
  const lastPlannedIdxByAccount = new Map<string, number>();

  function addPlanned(accountId: string, year: number, month: number, boites: number, ca: number) {
    plannedCaByMonth.set(monthKey(year, month), (plannedCaByMonth.get(monthKey(year, month)) ?? 0) + ca);
    plannedBoitesByAccountTotal.set(accountId, (plannedBoitesByAccountTotal.get(accountId) ?? 0) + boites);
  }
  function noteLastIdx(accountId: string, idx: number) {
    const cur = lastPlannedIdxByAccount.get(accountId);
    if (cur === undefined || idx > cur) lastPlannedIdxByAccount.set(accountId, idx);
  }

  // Point de départ : ce qui sera réellement affiché — la génération de base
  // qui vient d'être calculée, plus les lignes manuelles existantes (jamais
  // recalculées). Les anciennes lignes 'auto' d'une génération précédente
  // sont ignorées : elles seront remplacées par `out` au moment de l'upsert.
  for (const f of out) {
    addPlanned(f.account_id, f.year, f.month, f.boites_prevues, f.ca_prevu);
    noteLastIdx(f.account_id, monthIndex(f.year, f.month));
  }
  for (const e of existing) {
    if (e.source !== "manuel") continue;
    addPlanned(e.account_id, e.year, e.month, e.boites_prevues ?? 0, e.ca_prevu ?? 0);
    noteLastIdx(e.account_id, monthIndex(e.year, e.month));
  }
  for (const [accId, salesArr] of salesByAccount) {
    const ordered = orderedMonthIndices(salesArr);
    if (ordered.length > 0) noteLastIdx(accId, ordered[ordered.length - 1]);
  }

  const sortedTargets = [...targetMonths].sort(
    (a, b) => monthIndex(a.year, a.month) - monthIndex(b.year, b.month)
  );

  for (const tm of sortedTargets) {
    const objectifCa = sectorObjectives.find((o) => o.year === tm.year && o.month === tm.month)?.objectif_ca ?? 0;
    if (objectifCa <= 0) continue;
    let gapCa = objectifCa - (plannedCaByMonth.get(monthKey(tm.year, tm.month)) ?? 0);
    if (gapCa <= 0) continue;

    const tmIdx = monthIndex(tm.year, tm.month);

    const candidates = accounts
      .filter((a) => a.status !== "lost")
      .map((account) => {
        const caParBoite =
          account.realise_boites && account.realise_boites > 0 && account.ca_2026_ytd
            ? account.ca_2026_ytd / account.realise_boites
            : prixBoiteHT(account.price_list);
        const potentiel = account.potentiel_boites ?? 0;
        const alreadyPlanned = plannedBoitesByAccountTotal.get(account.id) ?? 0;
        // Le seul plafond dur : ce qu'il reste réellement de potentiel de
        // marché, une fois déduits le réalisé et tout ce qui est déjà prévu
        // (base + manuel + top-up précédent) sur l'horizon.
        const headroomTotal = Math.max(potentiel - (account.realise_boites ?? 0) - alreadyPlanned, 0);
        return { account, caParBoite, headroomTotal };
      })
      .filter((c) => c.headroomTotal > 0 && c.caParBoite > 0)
      .sort((a, b) => b.headroomTotal - a.headroomTotal);

    for (const cand of candidates) {
      if (gapCa <= 0) break;
      const { account, caParBoite, headroomTotal } = cand;

      const ordered = orderedMonthIndices(salesByAccount.get(account.id) ?? []);
      const bucket = recurrenceBucket(ordered);
      const normalGap = RECURRENCE_GAP_MONTHS[bucket] ?? GAP_MOIS_PAR_DEFAUT;
      const relaxedGap = Math.max(1, Math.floor(normalGap / TOP_UP_GAP_DIVISOR));
      const lastIdx = lastPlannedIdxByAccount.get(account.id);
      // Assoupli, pas supprimé : un compte a quand même besoin d'un minimum
      // de temps pour écouler ce qui vient de lui être prévu.
      if (lastIdx !== undefined && tmIdx - lastIdx < relaxedGap) continue;

      const boitesForGap = Math.ceil(gapCa / caParBoite);
      const boites = Math.min(boitesForGap, headroomTotal);
      if (boites < TOP_UP_MIN_BOITES) continue;

      const ca = Math.round(boites * caParBoite);

      // Un compte déjà prévu ce mois-ci par la génération de base reçoit un
      // complément sur la même ligne plutôt qu'une seconde ligne concurrente
      // (l'upsert (account_id, year, month, kind) ne pourrait garder que
      // l'une des deux).
      const existingLine = out.find(
        (f) => f.account_id === account.id && f.year === tm.year && f.month === tm.month
      );
      if (existingLine) {
        existingLine.boites_prevues += boites;
        existingLine.ca_prevu += ca;
        existingLine.note = `${existingLine.note} · Complément pour l'objectif secteur`;
      } else {
        out.push({
          account_id: account.id,
          year: tm.year,
          month: tm.month,
          boites_prevues: boites,
          ca_prevu: ca,
          note: "Complément auto — pour atteindre l'objectif secteur",
          hcp: allocateToHcps(hcpsByAccount.get(account.id) ?? [], boites, ca),
        });
      }

      addPlanned(account.id, tm.year, tm.month, boites, ca);
      noteLastIdx(account.id, tmIdx);
      gapCa -= ca;
    }
  }
}

/**
 * Applique le modèle prédictif à tout le portefeuille. Chaque mois cible est
 * recalculé pour les comptes non "lost" — y compris les mois déjà remplis
 * par une précédente exécution du générateur (`source: 'auto'`), qui sont
 * ainsi actualisés avec les données les plus fraîches. Les mois saisis à la
 * main (`source: 'manuel'`) ne sont jamais recalculés ni écrasés.
 *
 * `purchaseLines` (optionnel, `account_product_purchases`) alimente le signal
 * produit de `evaluateMonthSignal` — sans cette donnée, le modèle se rabat
 * intégralement sur la récurrence agrégée toutes marques confondues, comme
 * avant.
 */
export function predictPortfolioForecast(
  accounts: Account[],
  hcpsByAccount: Map<string, HcpLite[]>,
  sales: MonthlySaleRow[],
  existing: ExistingForecastEntry[],
  targetMonths: { year: number; month: number }[],
  sectorObjectives: SectorObjective[] = [],
  purchaseLines: PurchaseLine[] = []
): PredictedForecast[] {
  const salesByAccount = new Map<string, MonthlySaleRow[]>();
  for (const s of sales) {
    const arr = salesByAccount.get(s.account_id);
    if (arr) arr.push(s);
    else salesByAccount.set(s.account_id, [s]);
  }
  const existingByAccount = new Map<string, ExistingForecastEntry[]>();
  for (const e of existing) {
    const arr = existingByAccount.get(e.account_id);
    if (arr) arr.push(e);
    else existingByAccount.set(e.account_id, [e]);
  }

  // Vélocité par marque calculée sur tout le portefeuille (repli "population"
  // pour les essais uniques), puis prédiction compte × marque — voir
  // sonarscore/velocity.ts et sonarscore/prediction.ts, réutilisés tels
  // quels.
  const brandVelocities = computeBrandVelocities(purchaseLines);
  const brandPredictionsByAccount = new Map<string, AccountBrandPrediction[]>();
  for (const p of predictNextOrders(purchaseLines, brandVelocities)) {
    const arr = brandPredictionsByAccount.get(p.accountId);
    if (arr) arr.push(p);
    else brandPredictionsByAccount.set(p.accountId, [p]);
  }

  const out: PredictedForecast[] = [];
  for (const account of accounts) {
    if (account.status === "lost") continue;
    const preds = predictMonthlyForecast(
      account,
      hcpsByAccount.get(account.id) ?? [],
      salesByAccount.get(account.id) ?? [],
      targetMonths,
      existingByAccount.get(account.id) ?? [],
      brandPredictionsByAccount.get(account.id) ?? []
    );
    out.push(...preds);
  }

  // Écart résiduel vs objectif secteur : comble ce que la génération de base,
  // volontairement prudente, laisse de côté — voir applySectorObjectiveTopUp.
  applySectorObjectiveTopUp(out, accounts, hcpsByAccount, salesByAccount, existing, sectorObjectives, targetMonths);

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
        : potentielRestant * prixBoiteHT(account.price_list);

    if (historyPoints >= 3 && objectifCa > 0) {
      const caParBoite =
        account.realise_boites && account.realise_boites > 0 && account.ca_2026_ytd
          ? account.ca_2026_ytd / account.realise_boites
          : prixBoiteHT(account.price_list);
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
