import type { Account } from "@/types/database";

export type OpportunityType = "reactivation" | "cross_sell" | "declin" | "relance_appel" | "potentiel";

export interface Opportunity {
  account: Account;
  type: OpportunityType;
  label: string;
  reason: string;
  /** montant en € servant à prioriser (CA à regagner / à capter) */
  value: number;
}

export const OPPORTUNITY_META: Record<OpportunityType, { label: string; color: string }> = {
  reactivation: { label: "Réactivation", color: "#dc2626" },
  declin: { label: "Déclin à enrayer", color: "#d97706" },
  cross_sell: { label: "Cross-sell", color: "#0d9488" },
  relance_appel: { label: "Relance appel", color: "#b45309" },
  potentiel: { label: "Potentiel inexploité", color: "#4f46e5" },
};

/**
 * Détection d'opportunités par règles, uniquement à partir de champs réels
 * importés (silence, CA historique, évolution, appels, potentiel, produits).
 * Chaque compte n'apparaît qu'une fois, sur sa raison la plus forte.
 */
export function detectOpportunities(
  accounts: Account[],
  productsByAccount: Map<string, { brand: string; qty: number }[]>,
  totalBrandCount: number
): Opportunity[] {
  const opportunities: Opportunity[] = [];

  for (const a of accounts) {
    const caRef = a.ca_2025 ?? 0;

    // 1. Réactivation : compte qui générait du CA et devenu silencieux
    if ((a.jours_silence ?? 0) > 90 && caRef > 2000 && a.status !== "lost") {
      opportunities.push({
        account: a,
        type: "reactivation",
        label: "Réactiver",
        reason: `${a.jours_silence} jours sans commande — ${Math.round(caRef).toLocaleString("fr-FR")} € de CA 2025 à regagner`,
        value: caRef,
      });
      continue;
    }

    // 2. Déclin : forte chute 25→26 sur un compte qui pèse
    if ((a.evolution_pct ?? 0) < -0.5 && caRef > 5000 && a.status === "actif") {
      opportunities.push({
        account: a,
        type: "declin",
        label: "Enrayer le déclin",
        reason: `Évolution ${Math.round((a.evolution_pct ?? 0) * 100)}% vs 2025 — compte encore actif, agir vite`,
        value: caRef * Math.abs(a.evolution_pct ?? 0),
      });
      continue;
    }

    // 3. Cross-sell : compte actif avec beaucoup de marques non achetées
    const bought = productsByAccount.get(a.id) ?? [];
    const activeBrands = bought.filter((p) => p.qty > 0).length;
    if (totalBrandCount > 0 && a.status === "actif" && activeBrands > 0 && activeBrands <= totalBrandCount / 2 && caRef > 3000) {
      opportunities.push({
        account: a,
        type: "cross_sell",
        label: "Élargir la gamme",
        reason: `${activeBrands}/${totalBrandCount} marques achetées — mix incomplet sur un compte fidèle`,
        value: caRef * 0.3,
      });
      continue;
    }

    // 4. Relance appel : actif mais plus contacté depuis longtemps
    if (a.status === "actif" && (a.days_since_last_call ?? 0) > 90) {
      opportunities.push({
        account: a,
        type: "relance_appel",
        label: "Reprendre contact",
        reason: `${a.days_since_last_call} jours depuis le dernier appel`,
        value: caRef * 0.2,
      });
      continue;
    }

    // 5. Potentiel inexploité : gros potentiel déclaré, faible réalisation
    const potentiel = a.potentiel_boites ?? 0;
    const realise = a.realise_boites ?? 0;
    if (potentiel >= 100 && realise < potentiel * 0.2 && a.status !== "lost") {
      opportunities.push({
        account: a,
        type: "potentiel",
        label: "Développer",
        reason: `${realise}/${potentiel} boîtes du potentiel réalisées — marge de progression forte`,
        value: (potentiel - realise) * 130,
      });
    }
  }

  return opportunities.sort((o1, o2) => o2.value - o1.value);
}
