import type { Account } from "@/types/database";

/**
 * Un compte est considéré comme prospect s'il n'a pas commandé depuis plus
 * de 12 mois (donc "lost"), s'il est explicitement marqué lost/new, ou s'il
 * n'a jamais commandé. Définition demandée pour le pilotage.
 */
export function isProspect(a: Account): boolean {
  if (a.status === "lost" || a.status === "new") return true;
  if (a.last_order_date) {
    const days = (Date.now() - new Date(a.last_order_date).getTime()) / 86400000;
    return days > 365;
  }
  // aucune date de commande connue → jamais commandé
  return (a.ca_2024 ?? 0) === 0 && (a.ca_2025 ?? 0) === 0 && (a.ca_2026_ytd ?? 0) === 0;
}
