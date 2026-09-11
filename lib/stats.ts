/**
 * Statistiques descriptives partagées. `median` était réimplémentée à
 * l'identique dans 4 modules (persona, velocity, seasonality, prediction),
 * avec deux conventions divergentes sur le tableau vide (0 vs null) — d'où
 * les deux variantes explicites ci-dessous plutôt qu'un choix implicite.
 */

/** Médiane, ou `null` si aucune valeur. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Médiane avec repli à 0 sur tableau vide. */
export function medianOrZero(values: number[]): number {
  return median(values) ?? 0;
}

export function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

/** Moyenne, ou `null` si aucune valeur. */
export function mean(values: number[]): number | null {
  return values.length === 0 ? null : sum(values) / values.length;
}
