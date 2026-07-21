import * as XLSX from "xlsx";
import { excelSerialToISODate } from "./parser";

/**
 * Le "Rapport Salesforce.xls" est en réalité un export HTML (le contenu
 * commence par <head>...<table>), pas un vrai binaire .xls. On le parse
 * comme du texte, pas via la lib xlsx.
 */
export interface RawSalesforceRow {
  name: string;
  segment: string | null;
  competitor: string | null;
  potentielBoites: number | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  externalRef: string | null;
  email: string | null;
  mobile: string | null;
  telephone: string | null;
  email2: string | null;
  website: string | null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .trim();
}

export function parseSalesforceReport(buffer: ArrayBuffer): RawSalesforceRow[] {
  const html = new TextDecoder("iso-8859-1").decode(buffer);
  const rowMatches = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const rows: RawSalesforceRow[] = [];

  for (const rowHtml of rowMatches.slice(1)) {
    // skip header row
    const cellMatches = rowHtml.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g) ?? [];
    const cells = cellMatches.map((c) => stripTags(c));
    if (cells.length < 13 || !cells[0]) continue;

    const potentielRaw = cells[3]?.replace(/[^\d.,-]/g, "").replace(",", ".");
    const externalRefRaw = cells[7]?.trim() || null;

    rows.push({
      name: cells[0].trim(),
      segment: cells[1]?.trim() || null,
      competitor: cells[2]?.trim() || null,
      potentielBoites: potentielRaw ? Number(potentielRaw) : null,
      address: cells[4]?.trim() || null,
      postalCode: cells[5]?.trim() || null,
      city: cells[6]?.trim() || null,
      externalRef: externalRefRaw ? externalRefRaw.replace(/^FR-/, "") : null,
      email: cells[8]?.trim() || null,
      mobile: cells[9]?.trim() || null,
      telephone: cells[10]?.trim() || null,
      email2: cells[11]?.trim() || null,
      website: cells[12]?.trim() || null,
    });
  }

  return rows;
}

export interface RawInvoiceRow {
  customerName: string;
  invoiceNumber: string;
  date: string; // ISO
  totalExclTax: number;
  status: string | null;
}

/** "ACCOUNT DETAIL.xlsx" — un facture par ligne. */
export function parseAccountDetail(buffer: ArrayBuffer): RawInvoiceRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  const result: RawInvoiceRow[] = [];
  for (const row of rows.slice(1)) {
    const customerName = row[0] ? String(row[0]).trim() : null;
    const invoiceNumber = row[1] ? String(row[1]).trim() : null;
    const rawDate = row[3];
    const date =
      rawDate instanceof Date
        ? rawDate.toISOString().slice(0, 10)
        : typeof rawDate === "number"
        ? excelSerialToISODate(rawDate)
        : null;
    if (!customerName || !invoiceNumber || !date) continue;
    result.push({
      customerName,
      invoiceNumber,
      date,
      totalExclTax: typeof row[6] === "number" ? row[6] : 0,
      status: row[10] ? String(row[10]) : null,
    });
  }
  return result;
}

export interface RawInvoiceProductRow {
  invoiceNumber: string;
  description: string;
  date: string;
  qty: number;
  valueEur: number;
}

/** "INVOICE NUMBER ET PRODUCT.xlsx" — une ligne produit par facture (+ une ligne "Total" à ignorer). */
export function parseInvoiceProducts(buffer: ArrayBuffer): RawInvoiceProductRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  const result: RawInvoiceProductRow[] = [];
  for (const row of rows.slice(1)) {
    const invoiceNumber = row[0] ? String(row[0]).trim() : null;
    const description = row[1] ? String(row[1]).trim() : null;
    const rawDate = row[2];
    const date =
      rawDate instanceof Date
        ? rawDate.toISOString().slice(0, 10)
        : typeof rawDate === "number"
        ? excelSerialToISODate(rawDate)
        : null;
    if (!invoiceNumber || !description || description === "Total" || !date) continue;
    result.push({
      invoiceNumber,
      description,
      date,
      qty: typeof row[3] === "number" ? row[3] : 0,
      valueEur: typeof row[4] === "number" ? row[4] : 0,
    });
  }
  return result;
}

/**
 * Les libellés produit varient selon l'emballage/le canal (MDR, WS, boîte
 * de 1 ou 2) pour la même référence — on les regroupe sous un nom canonique
 * cohérent avec celui déjà utilisé par l'import "Croissance par marque".
 */
export function canonicalizeBrand(description: string): string {
  const d = description.toUpperCase();
  if (d.includes("KISS VOLUME")) return "RHA Kiss Volume";
  if (d.includes("KISS")) return "Kiss";
  if (d.includes("RHA 1") || d.includes("RHA1")) return "RHA 1";
  if (d.includes("RHA 2") || d.includes("RHA2")) return "RHA 2";
  if (d.includes("RHA 3") || d.includes("RHA3")) return "RHA 3";
  if (d.includes("RHA 4") || d.includes("RHA4")) return "RHA 4";
  if (d.includes("REDENSITY 2") || d.includes("REDENSITY II") || d.includes("RED2")) return "Redensity 2";
  if (d.includes("REDENSITY 1") || d.includes("REDENSITY I") || d.includes("RED1")) return "Redensity 1";
  if (d.includes("ULTRA DEEP")) return "Ultra Deep";
  if (d.includes("DEEP LINES")) return "Deep Lines";
  if (d.includes("GLOBAL ACTION")) return "Global Action";
  if (d.includes("ULTIMATE")) return "Ultimate";
  return description.trim();
}
