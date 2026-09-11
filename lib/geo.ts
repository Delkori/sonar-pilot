import type { Account } from "@/types/database";

/**
 * Référentiel des départements couverts par le secteur. Vivait dans
 * `components/dashboard/DepartmentBreakdown.tsx`, ce qui obligeait les
 * pages serveur et la carte à importer un composant client pour lire une
 * simple table de libellés.
 */
export const DEPT_NAMES: Record<string, string> = {
  "01": "Ain",
  "03": "Allier",
  "07": "Ardèche",
  "15": "Cantal",
  "26": "Drôme",
  "38": "Isère",
  "42": "Loire",
  "43": "Haute-Loire",
  "58": "Nièvre",
  "63": "Puy-de-Dôme",
  "69": "Rhône",
  "71": "Saône-et-Loire",
  "73": "Savoie",
  "74": "Haute-Savoie",
};

/** Code département d'un compte : colonne dédiée, sinon préfixe du code postal. */
export function departmentCodeOf(account: Pick<Account, "department_code" | "postal_code">): string {
  return account.department_code || account.postal_code?.slice(0, 2) || "";
}

/** Libellé lisible d'un code département ("NC" = non renseigné). */
export function departmentLabel(code: string): string {
  if (code === "NC" || code === "") return "Non renseigné";
  return DEPT_NAMES[code] ?? `Dép ${code}`;
}
