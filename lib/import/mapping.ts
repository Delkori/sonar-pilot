import type { AccountStatus, Segment } from "@/types/database";
import { excelSerialToISODate } from "./parser";
import type { RawCallsRow, RawGrowthByBrandRow, RawKpiDataRow, RawKpiRow, RawPasRow } from "./parser";

export function normalizeSegment(value: unknown): Segment | null {
  const s = String(value ?? "").trim().toUpperCase();
  return (["A", "B", "C", "D", "E"] as const).includes(s as Segment) ? (s as Segment) : null;
}

/**
 * Statuts réellement observés dans les fichiers sources : Actif, Lost, TBD,
 * Prospect. Mappés vers le vocabulaire métier de l'app. "new"/"reconnected"
 * sont dérivés plus tard (première commande récente / reprise après silence),
 * pas présents tels quels dans Excel.
 */
export function normalizeStatus(value: unknown): AccountStatus {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "actif" || s === "active") return "actif";
  if (s === "lost") return "lost";
  if (s === "tbd" || s === "prospect") return "a_suivre";
  return "a_suivre";
}

/**
 * Lecture de colonne tolérante aux variations d'espaces/casse dans les en-têtes
 * Excel (ex: "Sales Qty Ordered  LY" avec un double espace vs un simple dans
 * le fichier réel) — un en-tête légèrement différent de celui codé en dur
 * faisait échouer silencieusement toute la colonne (valeur toujours null),
 * comme observé sur les colonnes LY/growth de "Customer Growth By Brand".
 */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function getColumn(row: Record<string, unknown>, candidate: string): unknown {
  const target = normalizeHeader(candidate);
  for (const key of Object.keys(row)) {
    if (normalizeHeader(key) === target) return row[key];
  }
  return undefined;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function departmentCodeFromPostal(postalCode: string | number | null): string | null {
  if (!postalCode) return null;
  const s = String(postalCode).trim().padStart(5, "0");
  if (!/^\d{5}$/.test(s)) return null;
  // Corse exceptions aside (not relevant to AURA), department = first 2 digits.
  return s.slice(0, 2);
}

const normalizeName = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

export interface AccountPatch {
  external_ref?: string;
  name: string;
  segment?: Segment | null;
  status?: AccountStatus;
  price_list?: string | null;
  potentiel_boites?: number | null;
  ca_2022?: number | null;
  ca_2023?: number | null;
  ca_2024?: number | null;
  ca_2025?: number | null;
  ca_2026_ytd?: number | null;
  jours_silence?: number | null;
  score?: number | null;
  action_recommandee?: string | null;
  objectif_boites?: number | null;
  realise_boites?: number | null;
  evolution_pct?: number | null;
  refs_manquantes?: string | null;
  owner?: string | null;
  hco_type?: string | null;
  city?: string | null;
  postal_code?: string | null;
  department_code?: string | null;
  last_call_date?: string | null;
  days_since_last_call?: number | null;
  first_order_date?: string | null;
  last_order_date?: string | null;
}

export function mapPasRow(row: RawPasRow): AccountPatch {
  const commentKey = Object.keys(row).find((k) => k.startsWith("COMMENTAIRES"));
  const refsKey = Object.keys(row).find((k) => k.startsWith("RÉFS MANQUANTES"));
  return {
    external_ref: String(row["CODE SAP"]).trim(),
    name: String(row["NOM DU COMPTE"]).trim(),
    segment: normalizeSegment(row.SEG),
    price_list: row.PARTENAIRES ? String(row.PARTENAIRES).trim() : null,
    potentiel_boites: toNumber(row["POT. (boîtes)"]),
    ca_2022: toNumber(row["CA 2022"]),
    ca_2023: toNumber(row["CA 2023"]),
    ca_2024: toNumber(row["CA 2024"]),
    ca_2025: toNumber(row["CA 2025"]),
    ca_2026_ytd: toNumber(row["CA 2026 YTD"]),
    jours_silence: toNumber(row.SILENCE),
    score: toNumber(row.SCORE),
    action_recommandee: row.ACTION ? String(row.ACTION).trim() : null,
    objectif_boites: toNumber(row["BOITES A FAIRE"]),
    realise_boites: toNumber(row["NB BOITES 2026"]),
    evolution_pct: toNumber(row["ÉVOL 25→26"]),
    refs_manquantes: refsKey ? String(row[refsKey] ?? "").trim() || null : null,
    _comment: commentKey ? String(row[commentKey] ?? "").trim() || null : null,
  } as AccountPatch & { _comment: string | null };
}

export function mapKpiRow(row: RawKpiRow): AccountPatch {
  return {
    external_ref: String(row["Code client"]).trim(),
    name: String(row["Nom du client"]).trim(),
    segment: normalizeSegment(row["Segmentation "]),
    status: normalizeStatus(row["Statuts de ventes clients"]),
    owner: row["Nom du commercial"] ? String(row["Nom du commercial"]).trim() : null,
    hco_type: row["HCO type"] ? String(row["HCO type"]).trim() : null,
    city: row.Ville ? String(row.Ville).trim() : null,
    postal_code: row["Code Postal "] ? String(row["Code Postal "]).trim() : null,
    department_code: departmentCodeFromPostal(row["Code Postal "]),
    price_list: row["Liste de prix"] ? String(row["Liste de prix"]).trim() : null,
  };
}

export function mapCallsRow(row: RawCallsRow): { name: string; patch: AccountPatch } {
  const date = row["Last Call Date"];
  const iso =
    date instanceof Date
      ? date.toISOString().slice(0, 10)
      : typeof date === "string" && date
      ? date
      : null;
  return {
    name: normalizeName(String(row["Customer Name"])),
    patch: {
      name: String(row["Customer Name"]).trim(),
      last_call_date: iso,
      days_since_last_call: toNumber(row["Days Since Last Call"]),
    },
  };
}

export interface ProductPatch {
  brand: string;
  sales_value_ly: number | null;
  sales_value_cy: number | null;
  qty_ordered_ly: number | null;
  qty_ordered_cy: number | null;
  growth_rate_pct: number | null;
  period: string;
}

export function mapGrowthByBrandRow(row: RawGrowthByBrandRow): { name: string; product: ProductPatch } {
  const r = row as unknown as Record<string, unknown>;
  return {
    name: normalizeName(String(row["Customer Name"])),
    product: {
      brand: String(row.Brand_Ml).trim(),
      sales_value_ly: toNumber(getColumn(r, "Sales Value LY")),
      sales_value_cy: toNumber(getColumn(r, "Sales Value CY")),
      qty_ordered_ly: toNumber(getColumn(r, "Sales Qty Ordered LY")),
      qty_ordered_cy: toNumber(getColumn(r, "Sales Qty Ordered CY")),
      growth_rate_pct: toNumber(getColumn(r, "Sales Growth Rate %")),
      period: "YTD 2026 vs 2025",
    },
  };
}

export function mapKpiDataRow(row: RawKpiDataRow): { externalRef: string; patch: AccountPatch } {
  return {
    externalRef: String(row["Code client"]).trim(),
    patch: {
      name: String(row["Nom du Client"] ?? "").trim(),
      first_order_date: excelSerialToISODate(row["Date première commande"]),
      last_order_date: excelSerialToISODate(row["Date dernière commande"]),
      owner: row["Nom du commercial"] ? String(row["Nom du commercial"]).trim() : null,
    },
  };
}

export { normalizeName };
