import * as XLSX from "xlsx";

/**
 * Reads the "SUIVI COMPTES" sheet of the PAS workbook. The sheet is a
 * dashboard-style tab: real column headers only start at row 10 (0-indexed
 * row 9), everything above is a synthèse block with merged cells.
 */
const SUIVI_COMPTES_HEADER_ROW = 9; // 0-indexed -> row 10 in Excel

export interface RawPasRow {
  "CODE SAP": string;
  "NOM DU COMPTE": string;
  SEG: string;
  PARTENAIRES: string;
  "POT. (boîtes)": number | null;
  "CA 2022": number | null;
  "CA 2023": number | null;
  "CA 2024": number | null;
  "CA 2025": number | null;
  "CA 2026 YTD": number | null;
  SILENCE: number | null;
  SCORE: number | null;
  ACTION: string;
  "BOITES A FAIRE": number | null;
  "NB BOITES 2026": number | null;
  "ÉVOL 25→26": number | null;
  [key: string]: unknown; // COMMENTAIRES / RÉFS MANQUANTES columns have emoji-suffixed headers
}

export function parsePasWorkbook(buffer: ArrayBuffer): RawPasRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets["SUIVI COMPTES"];
  if (!sheet) {
    throw new Error('Onglet "SUIVI COMPTES" introuvable dans le fichier.');
  }
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    range: SUIVI_COMPTES_HEADER_ROW,
    defval: null,
  });
  const [header, ...body] = rows as [string[], ...unknown[][]];
  return body
    .filter((row) => row[0]) // must have a CODE SAP
    .map((row) => {
      const obj: Record<string, unknown> = {};
      header.forEach((key, i) => {
        if (key) obj[String(key).trim()] = row[i] ?? null;
      });
      return obj as RawPasRow;
    });
}

export interface RawKpiRow {
  "Nom du commercial": string;
  "Code client": string;
  "Nom du client": string;
  CHANNEL: string;
  "HCO type": string;
  "Potentiel de boîtes": number | null;
  "Segmentation ": string;
  Ville: string;
  "Code Postal ": string | number;
  "Liste de prix": string;
  "Statuts de ventes clients": string;
}

export function parseKpiWorkbook(buffer: ArrayBuffer): RawKpiRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<RawKpiRow>(sheet, { defval: null });
  return rows.filter((r) => r["Code client"]);
}

export interface RawCallsRow {
  "Customer Name": string;
  "HCO Type": string;
  Segmentation: string;
  "Last Call Date": Date | string | null;
  "Days Since Last Call": number | null;
}

export function parseCallsWorkbook(buffer: ArrayBuffer): RawCallsRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<RawCallsRow>(sheet, { defval: null });
  return rows.filter((r) => r["Customer Name"]);
}
