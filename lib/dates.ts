/**
 * Libellés de mois et arithmétique de dates — source unique.
 *
 * Avant, `MONTH_LABELS` était redéclaré dans 8 composants (3 variantes de
 * casse/longueur) et le calcul « nombre de jours depuis » était réécrit à
 * la main (`/ 86400000`) dans 9 fichiers. Tout passe désormais par ici :
 * un libellé corrigé l'est partout, et la définition d'un « jour de
 * silence » ne peut plus diverger d'un module à l'autre.
 */

export const MONTHS_LONG = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
] as const;

export const MONTHS_SHORT = [
  "Jan",
  "Fév",
  "Mar",
  "Avr",
  "Mai",
  "Jun",
  "Jul",
  "Août",
  "Sep",
  "Oct",
  "Nov",
  "Déc",
] as const;

export const MONTHS_INITIAL = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] as const;

export const DAY_MS = 86_400_000;

/** Libellé court d'un mois 1-12 (renvoie "" hors plage). */
export function monthShort(month: number): string {
  return MONTHS_SHORT[month - 1] ?? "";
}

/** Libellé long d'un mois 1-12 (renvoie "" hors plage). */
export function monthLong(month: number): string {
  return MONTHS_LONG[month - 1] ?? "";
}

/** Nombre de jours entiers entre deux dates (b - a). */
export function daysBetween(a: string | Date, b: string | Date): number {
  const ta = a instanceof Date ? a.getTime() : new Date(a).getTime();
  const tb = b instanceof Date ? b.getTime() : new Date(b).getTime();
  return Math.round((tb - ta) / DAY_MS);
}

/** Jours écoulés depuis `date` (jamais négatif). `null` si date absente. */
export function daysSince(date: string | Date | null | undefined, asOf: Date = new Date()): number | null {
  if (!date) return null;
  return Math.max(Math.floor((asOf.getTime() - (date instanceof Date ? date : new Date(date)).getTime()) / DAY_MS), 0);
}

/** Semaines entières écoulées depuis `date`. `null` si date absente. */
export function weeksSince(date: string | Date | null | undefined, asOf: Date = new Date()): number | null {
  const days = daysSince(date, asOf);
  return days === null ? null : Math.floor(days / 7);
}

/** Date ISO (YYYY-MM-DD) décalée de `days` jours. */
export function addDays(date: string | Date, days: number): string {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setDate(d.getDate() + Math.round(days));
  return toDateStr(d);
}

/** Date locale au format YYYY-MM-DD (sans décalage UTC, contrairement à toISOString). */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Index absolu d'un mois, pour comparer/soustraire deux (année, mois). */
export function monthIndex(year: number, month: number): number {
  return year * 12 + month;
}

/** Index absolu du mois d'une date ISO. */
export function monthIndexFromDateStr(dateStr: string): number {
  const [y, m] = dateStr.split("-").map(Number);
  return monthIndex(y, m);
}

/** (année, mois) correspondant à un index absolu — inverse de `monthIndex`. */
export function fromMonthIndex(index: number): { year: number; month: number } {
  return { year: Math.floor((index - 1) / 12), month: ((index - 1) % 12) + 1 };
}
