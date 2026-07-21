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
  /** ex. "PREMIUM 70 boîtes à faire" — tier + objectif, colonne ajoutée par l'utilisateur */
  accountPartners: string | null;
  /** Nom de la structure (HCO) — rempli uniquement sur les lignes médecin (HCP) */
  parentPrincipal: string | null;
  rpps: string | null;
  taxId: string | null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .trim();
}

// En-têtes attendus (accents/casse tolérés) — on retrouve la colonne par
// son nom plutôt que sa position, pour ne pas casser si l'utilisateur
// ajoute/déplace des colonnes comme "Account Partners".
const HEADER_ALIASES: Record<string, string[]> = {
  name: ["nom du compte"],
  segment: ["segmentation"],
  competitor: ["nom concurrent"],
  potentielBoites: ["nb de boites d", "nb de bo"], // "Nb de boîtes d'injectables / An"
  address: ["adresse principale"],
  postalCode: ["code postal principal"],
  city: ["ville principale"],
  externalRef: ["id sap compte"],
  email: ["email"],
  mobile: ["mobile hco"],
  telephone: ["telephone", "téléphone"],
  email2: ["adresse e-mail n"],
  website: ["site web"],
  accountPartners: ["account partners"],
  parentPrincipal: ["parent principal"],
  rpps: ["rpps"],
  taxId: ["tax id"],
};

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // strip accents
}

export function parseSalesforceReport(buffer: ArrayBuffer): RawSalesforceRow[] {
  const html = new TextDecoder("iso-8859-1").decode(buffer);
  const rowMatches = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const headerRow = rowMatches[0];
  if (!headerRow) return [];

  const headerCells = (headerRow.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g) ?? []).map((c) =>
    normalizeHeader(stripTags(c))
  );

  const indexOf = (field: keyof typeof HEADER_ALIASES): number => {
    const aliases = HEADER_ALIASES[field];
    return headerCells.findIndex((h) => aliases.some((a) => h.includes(a)));
  };

  const idx = {
    name: indexOf("name"),
    segment: indexOf("segment"),
    competitor: indexOf("competitor"),
    potentielBoites: indexOf("potentielBoites"),
    address: indexOf("address"),
    postalCode: indexOf("postalCode"),
    city: indexOf("city"),
    externalRef: indexOf("externalRef"),
    email: indexOf("email"),
    mobile: indexOf("mobile"),
    telephone: indexOf("telephone"),
    email2: indexOf("email2"),
    website: indexOf("website"),
    accountPartners: indexOf("accountPartners"),
    parentPrincipal: indexOf("parentPrincipal"),
    rpps: indexOf("rpps"),
    taxId: indexOf("taxId"),
  };

  const rows: RawSalesforceRow[] = [];
  const cell = (cells: string[], i: number) => (i >= 0 ? cells[i]?.trim() || null : null);

  for (const rowHtml of rowMatches.slice(1)) {
    const cellMatches = rowHtml.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g) ?? [];
    const cells = cellMatches.map((c) => stripTags(c));
    const name = cell(cells, idx.name);
    if (!name) continue;

    const potentielRaw = cell(cells, idx.potentielBoites)?.replace(/[^\d.,-]/g, "").replace(",", ".");
    const externalRefRaw = cell(cells, idx.externalRef);

    rows.push({
      name,
      segment: cell(cells, idx.segment),
      competitor: cell(cells, idx.competitor),
      potentielBoites: potentielRaw ? Number(potentielRaw) : null,
      address: cell(cells, idx.address),
      postalCode: cell(cells, idx.postalCode),
      city: cell(cells, idx.city),
      externalRef: externalRefRaw ? externalRefRaw.replace(/^FR-/, "") : null,
      email: cell(cells, idx.email),
      mobile: cell(cells, idx.mobile),
      telephone: cell(cells, idx.telephone),
      email2: cell(cells, idx.email2),
      website: cell(cells, idx.website),
      accountPartners: cell(cells, idx.accountPartners),
      parentPrincipal: cell(cells, idx.parentPrincipal),
      rpps: cell(cells, idx.rpps),
      taxId: cell(cells, idx.taxId),
    });
  }

  return rows;
}

export interface AccountPartnersInfo {
  tier: string | null; // "Start" | "Pro" | "Pro+" | "Premium" | tel quel si non reconnu
  objectifBoites: number | null;
}

/**
 * Objectif fixe par tier, confirmé par l'utilisateur (cohérent avec
 * l'ancien PAS : "Pro+ — objectif 300 boîtes", "Premium — objectif 70
 * boîtes"). Start n'a pas de valeur fixe — trop variable selon le
 * potentiel de chaque compte.
 */
const TIER_OBJECTIVES: Record<string, number> = {
  Premium: 70,
  Pro: 150,
  "Pro+": 300,
};

/**
 * Parse une valeur du type "PREMIUM", "PRO 150 boites" ou "PRO+ 300
 * boîtes à faire". Si un nombre de boîtes est explicitement présent dans
 * la cellule, il prime ; sinon on retombe sur l'objectif fixe du tier.
 */
export function parseAccountPartners(value: string | null): AccountPartnersInfo {
  if (!value) return { tier: null, objectifBoites: null };
  const upper = value.toUpperCase();

  let tier: string | null = null;
  if (upper.includes("PRO+") || upper.includes("PRO PLUS")) tier = "Pro+";
  else if (upper.includes("PREMIUM")) tier = "Premium";
  else if (upper.includes("PRO")) tier = "Pro";
  else if (upper.includes("START")) tier = "Start";

  const qtyMatch = value.match(/(\d+)\s*bo[iî]tes?/i);
  const objectifBoites = qtyMatch ? Number(qtyMatch[1]) : tier ? TIER_OBJECTIVES[tier] ?? null : null;

  return { tier, objectifBoites };
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
