import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSpecialitesByRpps } from "@/lib/nexora/queries";
import { personaFromSpecialty, dominantPersona, type Persona } from "@/lib/persona";

/**
 * Synchronise, depuis Nexora (par RPPS), la spécialité et le persona de
 * chaque médecin, puis en déduit et STOCKE le persona dominant de chaque
 * compte. Persisté en base → survit aux mises à jour de ventes (l'import
 * n'écrase pas ces colonnes).
 */
export async function POST() {
  const supabase = await createClient();

  const { data: hcpsRaw } = await supabase.from("hcps").select("id, account_id, rpps");
  const hcps = (hcpsRaw ?? []) as { id: string; account_id: string | null; rpps: string | null }[];
  const rppsList = Array.from(new Set(hcps.map((h) => h.rpps).filter((r): r is string => !!r)));

  if (rppsList.length === 0) {
    return NextResponse.json({ error: "Aucun médecin avec RPPS — importez d'abord le Rapport Salesforce." }, { status: 400 });
  }

  const specialties = await getSpecialitesByRpps(rppsList);
  if (specialties.length === 0) {
    return NextResponse.json(
      { error: "Aucune spécialité renvoyée par Nexora — vérifiez les variables NEXORA_SUPABASE_URL / NEXORA_SUPABASE_ANON_KEY." },
      { status: 400 }
    );
  }

  const specByRpps = new Map(specialties.map((s) => [s.rpps, s] as const));

  // ── 1. MàJ des médecins (spécialité + persona), groupée par valeur
  const hcpGroups = new Map<string, { ids: string[]; specialite: string | null; persona: string | null }>();
  for (const h of hcps) {
    const s = h.rpps ? specByRpps.get(h.rpps) : undefined;
    if (!s) continue;
    const persona = personaFromSpecialty(s);
    const key = `${s.specialite ?? ""}||${persona ?? ""}`;
    const g = hcpGroups.get(key) ?? { ids: [], specialite: s.specialite, persona };
    g.ids.push(h.id);
    hcpGroups.set(key, g);
  }
  let hcpsUpdated = 0;
  for (const g of hcpGroups.values()) {
    const { error } = await supabase.from("hcps").update({ specialite: g.specialite, persona: g.persona }).in("id", g.ids);
    if (!error) hcpsUpdated += g.ids.length;
  }

  // ── 2. Persona dominant par compte
  const personasByAccount = new Map<string, (Persona | null)[]>();
  for (const h of hcps) {
    if (!h.account_id) continue;
    const s = h.rpps ? specByRpps.get(h.rpps) : undefined;
    const persona = s ? personaFromSpecialty(s) : null;
    const arr = personasByAccount.get(h.account_id);
    if (arr) arr.push(persona);
    else personasByAccount.set(h.account_id, [persona]);
  }
  const accountGroups = new Map<Persona, string[]>();
  for (const [accId, personas] of personasByAccount) {
    const p = dominantPersona(personas);
    if (!p) continue;
    const arr = accountGroups.get(p);
    if (arr) arr.push(accId);
    else accountGroups.set(p, [accId]);
  }
  let accountsUpdated = 0;
  for (const [persona, ids] of accountGroups) {
    const { error } = await supabase.from("accounts").update({ persona }).in("id", ids);
    if (!error) accountsUpdated += ids.length;
  }

  return NextResponse.json({ hcpsUpdated, accountsUpdated });
}
