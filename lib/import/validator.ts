import type { AccountPatch } from "./mapping";

export interface ImportLogEntry {
  row: number;
  message: string;
}

export interface ValidationResult {
  valid: (AccountPatch & { _row: number })[];
  errors: ImportLogEntry[];
}

/**
 * Minimal but strict validation: a row that fails is excluded and logged,
 * it never silently corrupts the account table. external_ref is the upsert
 * key so it must be present and unique within the file.
 */
export function validatePasRows(rows: AccountPatch[]): ValidationResult {
  const valid: (AccountPatch & { _row: number })[] = [];
  const errors: ImportLogEntry[] = [];
  const seenRefs = new Set<string>();

  rows.forEach((row, i) => {
    const excelRow = i + 11; // header at row 10, data starts row 11
    if (!row.external_ref) {
      errors.push({ row: excelRow, message: "CODE SAP manquant — ligne ignorée" });
      return;
    }
    if (!row.name) {
      errors.push({ row: excelRow, message: `NOM DU COMPTE manquant pour ${row.external_ref}` });
      return;
    }
    if (seenRefs.has(row.external_ref)) {
      errors.push({ row: excelRow, message: `CODE SAP ${row.external_ref} en doublon dans le fichier` });
      return;
    }
    if (row.segment === null) {
      errors.push({
        row: excelRow,
        message: `Segment invalide ou manquant pour ${row.external_ref} (attendu A/B/C/D/E) — importé sans segment`,
      });
    }
    seenRefs.add(row.external_ref);
    valid.push({ ...row, _row: excelRow });
  });

  return { valid, errors };
}

export function validateKpiRows(rows: AccountPatch[]): ValidationResult {
  const valid: (AccountPatch & { _row: number })[] = [];
  const errors: ImportLogEntry[] = [];

  rows.forEach((row, i) => {
    const excelRow = i + 4; // header at row 3 (0-indexed 2), data starts row 4
    if (!row.external_ref) {
      errors.push({ row: excelRow, message: "Code client manquant — ligne ignorée" });
      return;
    }
    if (row.postal_code && !/^\d{4,5}$/.test(row.postal_code)) {
      errors.push({
        row: excelRow,
        message: `Code postal "${row.postal_code}" invalide pour ${row.external_ref} — conservé tel quel`,
      });
    }
    valid.push({ ...row, _row: excelRow });
  });

  return { valid, errors };
}
