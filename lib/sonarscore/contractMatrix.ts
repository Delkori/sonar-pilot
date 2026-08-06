// Matrice contrat — croise le Tier comportemental SonarScore (rfms.ts) avec
// l'avancement du contrat Salesforce (objectif_boites / realise_boites),
// déjà en base et déjà exploités dans le prévisionnel (lib/forecast.ts) et
// la fiche compte, mais jamais recroisés avec un score comportemental.
//
// 2 axes seulement (Tier × avancement) — le palier contractuel (price_list)
// n'est volontairement PAS un 3e axe ici : il reste un attribut affiché à
// côté de chaque compte, pas fusionné dans la classification, en attendant
// de trancher s'il doit pondérer le SonarScore lui-même.

import type { SonarTier } from "./rfms";

export type AvancementBucket = "sous_avance" | "avance";

// Seuil de bascule sous-avancé / déjà avancé — ajustable, comme les poids
// RFM-S et les seuils de tier (cf. tâche #56, réglage du score).
const AVANCEMENT_THRESHOLD_PCT = 50;

export interface ContractProgress {
  accountId: string;
  objectifBoites: number | null;
  realiseBoites: number | null;
  avancementPct: number | null; // null si objectif non renseigné (pas de contrat chiffré)
  bucket: AvancementBucket | null;
}

export function computeContractProgress(
  accounts: { id: string; objectif_boites: number | null; realise_boites: number | null }[]
): ContractProgress[] {
  return accounts.map((a) => {
    const objectif = a.objectif_boites ?? null;
    const realise = a.realise_boites ?? 0;
    if (!objectif || objectif <= 0) {
      return { accountId: a.id, objectifBoites: objectif, realiseBoites: a.realise_boites, avancementPct: null, bucket: null };
    }
    const avancementPct = Math.round((realise / objectif) * 1000) / 10;
    return {
      accountId: a.id,
      objectifBoites: objectif,
      realiseBoites: a.realise_boites,
      avancementPct,
      bucket: avancementPct < AVANCEMENT_THRESHOLD_PCT ? "sous_avance" : "avance",
    };
  });
}

export type MatrixQuadrant =
  | "priorite_relance" // Tier haut + sous-avancé
  | "surveiller_renegocier" // Tier haut + déjà avancé
  | "a_qualifier" // Tier bas + sous-avancé
  | "ras" // Tier bas + déjà avancé
  | "inconnu"; // Tier ou avancement non disponible

export const QUADRANT_META: Record<MatrixQuadrant, { label: string; description: string; color: string }> = {
  priorite_relance: {
    label: "Priorité relance",
    description: "Bon comportement d'achat (Tier haut) mais contrat sous-avancé — marge de rattrapage identifiée.",
    color: "#dc2626",
  },
  surveiller_renegocier: {
    label: "Surveiller / renégocier à la hausse",
    description: "Bon comportement d'achat, contrat déjà avancé — peu de marge sur l'objectif actuel, contrat peut-être sous-dimensionné.",
    color: "#4f46e5",
  },
  a_qualifier: {
    label: "À qualifier",
    description: "Comportement d'achat faible (Tier bas), contrat sous-avancé — vérifier si le potentiel réel justifie une relance.",
    color: "#d97706",
  },
  ras: {
    label: "RAS",
    description: "Comportement d'achat faible, contrat déjà avancé (ou peu ambitieux) — rien de particulier à faire à court terme.",
    color: "#16a34a",
  },
  inconnu: {
    label: "Donnée insuffisante",
    description: "Tier comportemental ou objectif de contrat non disponible pour ce compte.",
    color: "#94a3b8",
  },
};

function tierIsHaut(tier: SonarTier): boolean {
  return tier === "tier_1" || tier === "tier_2";
}

export function classifyQuadrant(tier: SonarTier | null, bucket: AvancementBucket | null): MatrixQuadrant {
  if (tier === null || bucket === null) return "inconnu";
  const haut = tierIsHaut(tier);
  if (haut && bucket === "sous_avance") return "priorite_relance";
  if (haut && bucket === "avance") return "surveiller_renegocier";
  if (!haut && bucket === "sous_avance") return "a_qualifier";
  return "ras";
}

export interface ContractMatrixRow {
  accountId: string;
  priceList: string | null;
  tier: SonarTier | null;
  progress: ContractProgress;
  quadrant: MatrixQuadrant;
}

export function buildContractMatrix(
  accounts: { id: string; price_list: string | null; objectif_boites: number | null; realise_boites: number | null }[],
  tiers: Map<string, SonarTier>
): ContractMatrixRow[] {
  const progressByAccount = new Map(computeContractProgress(accounts).map((p) => [p.accountId, p]));
  return accounts.map((a) => {
    const progress = progressByAccount.get(a.id)!;
    const tier = tiers.get(a.id) ?? null;
    return {
      accountId: a.id,
      priceList: a.price_list,
      tier,
      progress,
      quadrant: classifyQuadrant(tier, progress.bucket),
    };
  });
}
