import type { Account } from "@/types/database";

/**
 * Score de ciblage /100 — reproduction exacte du barème du PAS :
 *   1. Segment Salesforce   25 pts
 *   2. Silence (semaines)   20 pts
 *   3. CA non capté         20 pts
 *   4. Références manquantes 15 pts
 *   5. Pénétration          10 pts
 *   6. Évolution 24→25      10 pts
 * Recalculé à la volée à chaque affichage : il évolue automatiquement
 * quand le silence s'allonge ou qu'un nouvel import actualise les CA.
 */

// Prix catalogue TTC moyen des références (skinboosters, cernes, volumes,
// rides, lèvres — 10 réf.), converti en HT (TVA 20%) puis remisé selon le
// tier de contrat du compte (41% Premium / 45% Pro / 50% Pro+), remises
// négociées communiquées par l'utilisateur. Remplace l'ancien prix moyen
// unique (133,66 €) qui ignorait entièrement le tier — un compte Premium
// payait donc, dans le modèle, le même prix par boîte qu'un Pro+ alors que
// l'écart réel est de 41% à 50% de remise.
const PRIX_CATALOGUE_MOYEN_TTC = 231.52;
const TVA = 1.2;
const PRIX_CATALOGUE_MOYEN_HT = PRIX_CATALOGUE_MOYEN_TTC / TVA;
const REMISE_PAR_TIER: Record<string, number> = { Premium: 0.41, Pro: 0.45, "Pro+": 0.5 };
const REMISE_PAR_DEFAUT =
  Object.values(REMISE_PAR_TIER).reduce((s, r) => s + r, 0) / Object.keys(REMISE_PAR_TIER).length;

/** Prix HT réaliste d'une boîte pour ce tier de contrat (moyenne catalogue si tier inconnu). */
export function prixBoiteHT(tier: string | null | undefined): number {
  const remise = tier ? REMISE_PAR_TIER[tier] : undefined;
  return PRIX_CATALOGUE_MOYEN_HT * (1 - (remise ?? REMISE_PAR_DEFAUT));
}

// Repli générique (tier inconnu) — gardé pour les rares appels sans compte
// en contexte. Préférer `prixBoiteHT(account.price_list)` partout ailleurs.
export const PRIX_MOYEN_BOITE = prixBoiteHT(null);
export const NB_REFS_FILLERS = 10;

export type ActionCode =
  | "visite_urgente"
  | "developper_pdm"
  | "reconquete"
  | "cross_sell"
  | "relance"
  | "fideliser";

export const ACTION_META: Record<ActionCode, { label: string; color: string; priority: number }> = {
  visite_urgente: { label: "🔴 Visite urgente", color: "#dc2626", priority: 0 },
  developper_pdm: { label: "🎯 Développer PDM", color: "#4f46e5", priority: 1 },
  reconquete: { label: "🟠 Reconquête", color: "#ea580c", priority: 2 },
  cross_sell: { label: "🟠 Cross-sell", color: "#d97706", priority: 3 },
  relance: { label: "🟡 Relance", color: "#ca8a04", priority: 4 },
  fideliser: { label: "🟢 Fidéliser", color: "#16a34a", priority: 5 },
};

export interface CriterionScore {
  key: string;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface TargetingScore {
  total: number;
  criteria: CriterionScore[];
  action: ActionCode;
  caNonCapte: number;
  penetration: number | null;
  silenceSemaines: number | null;
  refsManquantes: number | null;
}

function silenceEnSemaines(account: Account): number | null {
  // Formule PAS : (TODAY() - date dernière commande SAP) / 7
  if (account.last_order_date) {
    const days = (Date.now() - new Date(account.last_order_date).getTime()) / 86400000;
    return Math.max(Math.floor(days / 7), 0);
  }
  // repli : colonne SILENCE du PAS (en jours)
  if (account.jours_silence !== null) return Math.floor(account.jours_silence / 7);
  return null;
}

function refsManquantesCount(account: Account, refsAcheteesCount?: number): number | null {
  // source principale, la plus fiable : marques réellement achetées d'après
  // les factures/croissance par marque importées (account_products)
  if (refsAcheteesCount !== undefined) {
    return Math.max(NB_REFS_FILLERS - refsAcheteesCount, 0);
  }
  // repli historique : comptage PAS (peut être obsolète si le PAS n'est
  // plus réimporté)
  if (account.nb_refs_achetees_2025 !== null && account.nb_refs_achetees_2025 !== undefined) {
    return NB_REFS_FILLERS - account.nb_refs_achetees_2025;
  }
  if (account.refs_manquantes) {
    return account.refs_manquantes.split("/").filter((s) => s.trim()).length;
  }
  return null;
}

export function computeTargetingScore(
  account: Account,
  options?: { refsAcheteesCount?: number }
): TargetingScore {
  const criteria: CriterionScore[] = [];

  // 1. Segment — 25 pts
  const segPts = { A: 25, B: 20, C: 15, D: 8, E: 3 }[account.segment ?? "E"] ?? 3;
  criteria.push({
    key: "segment",
    label: "Segment Salesforce",
    points: segPts,
    max: 25,
    detail: account.segment ? `Segment ${account.segment}` : "Segment inconnu",
  });

  // 2. Silence — 20 pts
  const semaines = silenceEnSemaines(account);
  const silPts = semaines === null ? 3 : semaines >= 20 ? 20 : semaines >= 12 ? 15 : semaines >= 8 ? 8 : 3;
  criteria.push({
    key: "silence",
    label: "Silence",
    points: silPts,
    max: 20,
    detail: semaines === null ? "Date de dernière commande inconnue" : `${semaines} semaine(s) sans commande`,
  });

  // 3. CA non capté — 20 pts
  const prixBoite = prixBoiteHT(account.price_list);
  const potentielEUR = (account.potentiel_boites ?? 0) * prixBoite;
  const caNonCapte = Math.max(potentielEUR - (account.ca_2025 ?? 0), 0);
  const cncPts = caNonCapte >= 50000 ? 20 : caNonCapte >= 20000 ? 14 : caNonCapte > 5000 ? 8 : 2;
  criteria.push({
    key: "ca_non_capte",
    label: "CA non capté",
    points: cncPts,
    max: 20,
    detail: `${Math.round(caNonCapte).toLocaleString("fr-FR")} € (potentiel × ${prixBoite.toFixed(2)} € HT − CA 2025)`,
  });

  // 4. Références manquantes — 15 pts
  const refsManquantes = refsManquantesCount(account, options?.refsAcheteesCount);
  const refsPts =
    refsManquantes === null ? 1 : refsManquantes >= 9 ? 15 : refsManquantes >= 7 ? 10 : refsManquantes >= 5 ? 6 : 1;
  criteria.push({
    key: "refs",
    label: "Références manquantes",
    points: refsPts,
    max: 15,
    detail:
      refsManquantes === null
        ? "Données produit non importées"
        : `${refsManquantes}/${NB_REFS_FILLERS} références non achetées en 2025`,
  });

  // 5. Pénétration — 10 pts
  const penetration = potentielEUR > 0 ? (account.ca_2025 ?? 0) / potentielEUR : null;
  const penPts = penetration === null ? 0 : penetration < 0.1 ? 10 : penetration < 0.25 ? 6 : penetration < 0.5 ? 3 : 0;
  criteria.push({
    key: "penetration",
    label: "Pénétration",
    points: penPts,
    max: 10,
    detail: penetration === null ? "Potentiel non renseigné" : `${Math.round(penetration * 100)}% du potentiel capté`,
  });

  // 6. Évolution 24→25 — 10 pts
  const ca24 = account.ca_2024 ?? 0;
  const ca25 = account.ca_2025 ?? 0;
  let evolPts = 0;
  let evolDetail = "Stable ou en hausse";
  if (ca24 > 0 && ca25 === 0) {
    evolPts = 10;
    evolDetail = "Actif en 2024, aucun CA 2025 — client perdu";
  } else if (ca24 > 0) {
    const drop = (ca25 - ca24) / ca24;
    if (drop < -0.3) {
      evolPts = 8;
      evolDetail = `Baisse de ${Math.round(Math.abs(drop) * 100)}% vs 2024`;
    } else if (drop < 0) {
      evolPts = 4;
      evolDetail = `Baisse de ${Math.round(Math.abs(drop) * 100)}% vs 2024`;
    }
  }
  criteria.push({ key: "evolution", label: "Évolution 24→25", points: evolPts, max: 10, detail: evolDetail });

  const total = criteria.reduce((s, c) => s + c.points, 0);

  // Action recommandée — règles du PAS, dans l'ordre
  let action: ActionCode;
  if (total >= 70) action = "visite_urgente";
  else if (caNonCapte > 30000 && penetration !== null && penetration < 0.15) action = "developper_pdm";
  else if (ca25 === 0 && ca24 > 0) action = "reconquete";
  else if (penetration !== null && penetration < 0.15) action = "cross_sell";
  else if (total >= 45) action = "relance";
  else action = "fideliser";

  return { total, criteria, action, caNonCapte, penetration, silenceSemaines: semaines, refsManquantes };
}
