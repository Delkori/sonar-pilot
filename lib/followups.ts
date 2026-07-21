import type { Account, AccountAction } from "@/types/database";
import { ACTION_META, computeTargetingScore } from "./scoring";
import type { TargetingScore } from "./scoring";

export interface PhoneFollowUp {
  account: Account;
  score: TargetingScore;
  reason: string;
}

const SILENCE_THRESHOLD_DAYS = 21;

/**
 * Comptes à rappeler cette semaine pour décrocher une visite : silence
 * prolongé (>= 21 j sans contact) ou action recommandée jugée urgente par
 * le score de ciblage, en excluant les comptes déjà "lost" et ceux qui ont
 * déjà une relance/action programmée dans les 7 prochains jours.
 */
export function getPhoneFollowUps(accounts: Account[], actions: AccountAction[]): PhoneFollowUp[] {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const in7DaysStr = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);

  const hasPendingThisWeek = new Set(
    actions
      .filter(
        (a) =>
          !a.done &&
          a.due_date &&
          a.due_date >= todayStr &&
          a.due_date <= in7DaysStr &&
          (a.type === "relance" || a.type === "action")
      )
      .map((a) => a.account_id)
  );

  const result: PhoneFollowUp[] = [];
  for (const account of accounts) {
    if (account.status === "lost") continue;
    if (hasPendingThisWeek.has(account.id)) continue;

    const score = computeTargetingScore(account);
    const silence = account.jours_silence ?? 0;
    const urgent = score.action === "visite_urgente" || score.action === "reconquete" || score.action === "developper_pdm";
    if (!urgent && silence < SILENCE_THRESHOLD_DAYS) continue;

    const reasons: string[] = [];
    if (silence >= SILENCE_THRESHOLD_DAYS) reasons.push(`${silence} j sans contact`);
    if (urgent) reasons.push(ACTION_META[score.action].label.replace(/^\S+\s/, ""));
    result.push({ account, score, reason: reasons.join(" · ") || "À relancer" });
  }

  return result.sort(
    (a, b) => b.score.total - a.score.total || (b.account.jours_silence ?? 0) - (a.account.jours_silence ?? 0)
  );
}

/** Prochains jours ouvrés (lun-ven), pour répartir les appels sur la semaine. */
export function nextWeekdays(count: number): string[] {
  const days: string[] = [];
  const d = new Date();
  while (days.length < count) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
