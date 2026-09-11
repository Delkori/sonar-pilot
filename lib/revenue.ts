import type { Account } from "@/types/database";

/**
 * Chiffre d'affaires par année, sans colonne dédiée par année.
 *
 * Le schéma porte `ca_2022` … `ca_2026_ytd` : une colonne par exercice. Ce
 * modèle impose une migration ET une reprise de code à chaque 1ᵉʳ janvier, et
 * il a une date de péremption — en 2027, le dashboard n'aurait tout
 * simplement plus proposé l'année en cours, et le score de ciblage aurait
 * continué à comparer 2024 à 2025 indéfiniment.
 *
 * `account_monthly_sales` contient déjà l'information, année par année et
 * mois par mois, alimentée par les mêmes factures que ces colonnes. C'est
 * donc elle la source de vérité ici ; les colonnes annuelles ne servent plus
 * que de repli pour les exercices antérieurs à l'historique mensuel importé
 * (les CA repris de l'ancien PAS, notamment).
 */

export interface YearlySaleRow {
  account_id: string;
  year: number;
  ca: number;
}

/** Colonnes annuelles héritées, par année — repli uniquement. */
const LEGACY_YEAR_FIELDS: Record<number, keyof Account> = {
  2022: "ca_2022",
  2023: "ca_2023",
  2024: "ca_2024",
  2025: "ca_2025",
  2026: "ca_2026_ytd",
};

/** Le compte a-t-il un CA connu sur au moins un exercice historisé ? */
export function hasKnownRevenue(account: Partial<Account>): boolean {
  return Object.values(LEGACY_YEAR_FIELDS).some(
    (champ) => ((account[champ] as number | null | undefined) ?? 0) > 0
  );
}

/** CA agrégé par compte et par année, depuis les ventes mensuelles réelles. */
export function revenueByAccountYear(sales: YearlySaleRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sales) {
    if (!s.ca) continue;
    const key = `${s.account_id}|${s.year}`;
    map.set(key, (map.get(key) ?? 0) + s.ca);
  }
  return map;
}

/**
 * CA d'un compte pour une année donnée. Priorité aux ventes mensuelles
 * réelles ; repli sur la colonne annuelle héritée quand aucun mois n'est
 * connu pour cet exercice (import PAS ancien, jamais recoupé par des
 * factures). Renvoie 0 si les deux manquent — l'absence de facture EST un
 * chiffre d'affaires nul.
 */
export function revenueForYear(
  account: Pick<Account, "id"> & Partial<Account>,
  year: number,
  byAccountYear: Map<string, number>
): number {
  const mesure = byAccountYear.get(`${account.id}|${year}`);
  if (mesure !== undefined) return mesure;
  const champ = LEGACY_YEAR_FIELDS[year];
  if (!champ) return 0;
  return (account[champ] as number | null | undefined) ?? 0;
}

/**
 * Années proposables à l'affichage : celles réellement documentées (ventes
 * mensuelles ou colonne héritée non vide), plus l'année en cours — qui doit
 * rester sélectionnable dès le 1ᵉʳ janvier, avant la première facture.
 */
export function availableYears(
  sales: YearlySaleRow[],
  accounts: Partial<Account>[] = [],
  now: Date = new Date()
): number[] {
  const annees = new Set<number>([now.getFullYear()]);
  for (const s of sales) {
    if (s.ca) annees.add(s.year);
  }
  for (const [annee, champ] of Object.entries(LEGACY_YEAR_FIELDS)) {
    if (accounts.some((a) => ((a[champ] as number | null | undefined) ?? 0) > 0)) {
      annees.add(Number(annee));
    }
  }
  return [...annees].sort((a, b) => a - b);
}

/**
 * Années de référence du score de ciblage, relatives à la date du jour :
 * le dernier exercice clos et celui d'avant. Le barème du PAS raisonne sur
 * « l'an dernier » et « l'année précédente », pas sur 2025 et 2024 en dur.
 */
export function referenceYears(now: Date = new Date()): { derniereAnnee: number; anneePrecedente: number } {
  const enCours = now.getFullYear();
  return { derniereAnnee: enCours - 1, anneePrecedente: enCours - 2 };
}

/**
 * Prix moyen constaté d'une boîte chez ce compte : CA de l'exercice en cours
 * rapporté aux boîtes réellement livrées. Lu auparavant dans `ca_2026_ytd`,
 * donc figé sur 2026 : à partir de 2027, il divisait le CA d'un exercice
 * clos par un volume de l'exercice courant. Renvoie `null` si le rapport
 * n'est pas calculable, à charge de l'appelant de se replier sur le tarif.
 */
export function caParBoiteObserve(
  account: Pick<Account, "id" | "realise_boites"> & Partial<Account>,
  byAccountYear: Map<string, number>,
  now: Date = new Date()
): number | null {
  const boites = account.realise_boites ?? 0;
  if (boites <= 0) return null;
  const ca = revenueForYear(account, now.getFullYear(), byAccountYear);
  return ca > 0 ? ca / boites : null;
}
