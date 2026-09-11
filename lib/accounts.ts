import type { Account, AccountStatus } from "@/types/database";
import { daysSince, monthIndex } from "@/lib/dates";

/**
 * Statut dérivé de l'activité réelle (dernière commande facturée), pas d'un
 * libellé Salesforce libre — plus fiable et toujours à jour au fil des
 * imports. Un compte n'ayant jamais commandé reste "à suivre" (prospect).
 */
export function statusFromLastOrder(lastOrderDate: string | null): AccountStatus {
  const silenceDays = daysSince(lastOrderDate);
  if (silenceDays === null) return "a_suivre";
  if (silenceDays <= 180) return "actif";
  if (silenceDays <= 730) return "a_risque";
  return "lost";
}

export type RecurrenceBucket = "Mensuelle" | "Bimestrielle" | "Trimestrielle" | "Espacée" | "Unique";

export const RECURRENCE_BUCKETS: RecurrenceBucket[] = [
  "Mensuelle",
  "Bimestrielle",
  "Trimestrielle",
  "Espacée",
  "Unique",
];

/** Cadence d'un compte à partir des mois où il a commandé (year*12+month). */
export function recurrenceBucket(orderMonths: number[]): RecurrenceBucket {
  if (orderMonths.length < 2) return "Unique";
  const sorted = [...orderMonths].sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < sorted.length; i++) gap += sorted[i] - sorted[i - 1];
  const avg = gap / (sorted.length - 1);
  if (avg <= 1.3) return "Mensuelle";
  if (avg <= 2.5) return "Bimestrielle";
  if (avg <= 4) return "Trimestrielle";
  return "Espacée";
}

/** Cadence de commande par compte, depuis les ventes mensuelles réelles. */
export function recurrenceByAccount(
  sales: { account_id: string; year: number; month: number; ca: number }[]
): Map<string, RecurrenceBucket> {
  const byAcc = new Map<string, number[]>();
  for (const s of sales) {
    if (s.ca <= 0) continue;
    const idx = monthIndex(s.year, s.month);
    const arr = byAcc.get(s.account_id);
    if (arr) arr.push(idx);
    else byAcc.set(s.account_id, [idx]);
  }
  const out = new Map<string, RecurrenceBucket>();
  for (const [id, months] of byAcc) out.set(id, recurrenceBucket(months));
  return out;
}

/**
 * Un compte est considéré comme prospect s'il n'a pas commandé depuis plus
 * de 12 mois (donc "lost"), s'il est explicitement marqué lost/new, ou s'il
 * n'a jamais commandé. Définition demandée pour le pilotage.
 */
export function isProspect(a: Account): boolean {
  if (a.status === "lost" || a.status === "new") return true;
  const days = daysSince(a.last_order_date);
  if (days !== null) return days > 365;
  // aucune date de commande connue → jamais commandé
  return (a.ca_2024 ?? 0) === 0 && (a.ca_2025 ?? 0) === 0 && (a.ca_2026_ytd ?? 0) === 0;
}
