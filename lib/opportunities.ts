import type { Account } from "@/types/database";
import { ACTION_META, computeTargetingScore } from "@/lib/scoring";
import type { ActionCode, TargetingScore } from "@/lib/scoring";
import { referenceYears, revenueForYear } from "@/lib/revenue";

const EMPTY_REVENUE = new Map<string, number>();

export type OpportunityType = ActionCode;

export interface Opportunity {
  account: Account;
  type: OpportunityType;
  label: string;
  reason: string;
  /** montant en € servant à prioriser (CA non capté / CA à regagner) */
  value: number;
  score: TargetingScore;
}

export const OPPORTUNITY_META = ACTION_META;

/**
 * Les opportunités découlent directement du score de ciblage /100 du PAS :
 * tout compte dont l'action recommandée n'est pas "Fidéliser" est une
 * opportunité, triée par score décroissant puis par CA en jeu.
 */
export function detectOpportunities(
  accounts: Account[],
  caByAccountYear?: Map<string, number>
): Opportunity[] {
  const opportunities: Opportunity[] = [];
  const { anneePrecedente } = referenceYears();

  for (const account of accounts) {
    const score = computeTargetingScore(account, { caByAccountYear });
    if (score.action === "fideliser") continue;

    const topCriteria = [...score.criteria]
      .filter((c) => c.points > 0)
      .sort((c1, c2) => c2.points / c2.max - c1.points / c1.max)
      .slice(0, 2);

    // CA à regagner = ce que le compte faisait avant de s'arrêter, soit
    // l'avant-dernier exercice. `ca_2024` en dur désignait cet exercice en
    // 2026 seulement.
    const value =
      score.action === "reconquete"
        ? revenueForYear(account, anneePrecedente, caByAccountYear ?? EMPTY_REVENUE)
        : score.caNonCapte;

    opportunities.push({
      account,
      type: score.action,
      label: ACTION_META[score.action].label,
      reason: `Score ${score.total}/100 — ${topCriteria.map((c) => c.detail).join(" · ")}`,
      value,
      score,
    });
  }

  return opportunities.sort(
    (o1, o2) => o2.score.total - o1.score.total || o2.value - o1.value
  );
}
