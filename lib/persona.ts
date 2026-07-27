// Module Persona : profils d'achat type par spécialité.
// 3 personas cibles ; le persona d'un COMPTE = spécialité dominante de ses
// médecins (via RPPS → Nexora). Le modèle type d'un persona = classement des
// références selon leur pénétration chez les comptes de ce persona.

export const PERSONAS = ["Dermatologue", "Chirurgien plasticien", "Médecin esthétique"] as const;
export type Persona = (typeof PERSONAS)[number];

export const PERSONA_COLORS: Record<Persona, string> = {
  Dermatologue: "#0ea5e9",
  "Chirurgien plasticien": "#6366f1",
  "Médecin esthétique": "#14b8a6",
};

export interface SpecialtyInput {
  specialite: string | null;
  is_esth: boolean;
  is_derm: boolean;
  is_chir: boolean;
}

/** Classe un médecin dans un persona à partir de sa spécialité / ses drapeaux. */
export function personaFromSpecialty(r: SpecialtyInput): Persona | null {
  const s = (r.specialite ?? "").toLowerCase();
  if (r.is_derm || s.includes("dermatolog")) return "Dermatologue";
  if (r.is_chir || s.includes("chirurgie plastique") || s.includes("plasticien") || s.includes("maxillo"))
    return "Chirurgien plasticien";
  if (r.is_esth) return "Médecin esthétique";
  return null;
}

/** Persona dominant d'un compte parmi les personas de ses médecins. */
export function dominantPersona(personas: (Persona | null)[]): Persona | null {
  const counts = new Map<Persona, number>();
  for (const p of personas) if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  if (counts.size === 0) return null;
  let best: Persona | null = null;
  let bestN = -1;
  for (const p of PERSONAS) {
    const n = counts.get(p) ?? 0;
    if (n > bestN) {
      bestN = n;
      best = p;
    }
  }
  return best;
}

export interface ProductRow {
  account_id: string;
  brand: string;
  qty_ordered_cy: number | null;
  sales_value_cy: number | null;
}

export interface BrandStat {
  brand: string;
  buyers: number;
  penetration: number; // part des comptes du persona qui achètent la référence
  medianQty: number;
  totalValue: number;
}

export interface PersonaModel {
  persona: Persona;
  accountCount: number;
  caTotal: number;
  brands: BrandStat[];
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Modèles types par persona : pour chaque persona, le classement des
 * références par pénétration (part des comptes qui les achètent).
 */
export function computePersonaModels(
  personaByAccount: Map<string, Persona>,
  products: ProductRow[],
  caByAccount: Map<string, number>
): PersonaModel[] {
  // comptes par persona
  const accountsByPersona = new Map<Persona, Set<string>>();
  for (const [acc, p] of personaByAccount) {
    let set = accountsByPersona.get(p);
    if (!set) {
      set = new Set();
      accountsByPersona.set(p, set);
    }
    set.add(acc);
  }

  // achats indexés par compte → marque
  const byAcc = new Map<string, Map<string, { qty: number; value: number }>>();
  for (const pr of products) {
    let m = byAcc.get(pr.account_id);
    if (!m) {
      m = new Map();
      byAcc.set(pr.account_id, m);
    }
    const cur = m.get(pr.brand) ?? { qty: 0, value: 0 };
    cur.qty += pr.qty_ordered_cy ?? 0;
    cur.value += pr.sales_value_cy ?? 0;
    m.set(pr.brand, cur);
  }

  const models: PersonaModel[] = [];
  for (const persona of PERSONAS) {
    const accts = accountsByPersona.get(persona);
    if (!accts || accts.size === 0) {
      models.push({ persona, accountCount: 0, caTotal: 0, brands: [] });
      continue;
    }
    const brandBuyers = new Map<string, { qtys: number[]; value: number }>();
    let caTotal = 0;
    for (const acc of accts) {
      caTotal += caByAccount.get(acc) ?? 0;
      const m = byAcc.get(acc);
      if (!m) continue;
      for (const [brand, v] of m) {
        if (v.qty <= 0) continue;
        const bb = brandBuyers.get(brand) ?? { qtys: [], value: 0 };
        bb.qtys.push(v.qty);
        bb.value += v.value;
        brandBuyers.set(brand, bb);
      }
    }
    const brands: BrandStat[] = Array.from(brandBuyers.entries())
      .map(([brand, bb]) => ({
        brand,
        buyers: bb.qtys.length,
        penetration: bb.qtys.length / accts.size,
        medianQty: median(bb.qtys),
        totalValue: bb.value,
      }))
      .sort((a, b) => b.penetration - a.penetration || b.medianQty - a.medianQty);
    models.push({ persona, accountCount: accts.size, caTotal, brands });
  }
  return models;
}

/**
 * Références à proposer à un compte : celles que ses pairs (même persona)
 * achètent majoritairement mais qu'il n'achète pas encore.
 */
export function personaRecommendations(
  model: PersonaModel | undefined,
  accountBrands: Set<string>,
  minPenetration = 0.4,
  max = 4
): BrandStat[] {
  if (!model) return [];
  return model.brands.filter((b) => b.penetration >= minPenetration && !accountBrands.has(b.brand)).slice(0, max);
}
