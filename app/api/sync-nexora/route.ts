import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNexoraClient } from "@/lib/supabase/nexora";

/**
 * Synchronise le sponsoring depuis le projet Supabase "nexora" (table
 * prospects_structures : match_medecin_key = "RPPS:xxxx", match_labo,
 * match_montant) vers notre table hcp_sponsorships. Remplacement complet
 * des lignes source='nexora' à chaque appel. Le rapprochement aux médecins
 * se fait côté fiche compte via le RPPS.
 */
export async function POST() {
  const nexora = createNexoraClient();
  if (!nexora) {
    return NextResponse.json(
      {
        error:
          "Connexion Nexora non configurée. Ajoutez NEXORA_SUPABASE_URL et NEXORA_SUPABASE_SERVICE_ROLE_KEY dans les variables d'environnement Vercel.",
      },
      { status: 400 }
    );
  }

  const { data, error } = await nexora
    .from("prospects_structures")
    .select("match_medecin_key, match_medecin_nom, match_labo, match_montant")
    .not("match_labo", "is", null);

  if (error) {
    return NextResponse.json({ error: `Lecture Nexora : ${error.message}` }, { status: 500 });
  }

  type Row = {
    match_medecin_key: string | null;
    match_medecin_nom: string | null;
    match_labo: string | null;
    match_montant: number | null;
  };

  const payload = ((data ?? []) as Row[])
    .filter((r) => r.match_labo)
    .map((r) => ({
      rpps: r.match_medecin_key ? r.match_medecin_key.replace(/^RPPS:/i, "").replace(/\s/g, "") : null,
      hcp_name: r.match_medecin_nom,
      laboratoire: r.match_labo as string,
      montant: r.match_montant,
      source: "nexora",
    }));

  const supabase = createAdminClient();
  await supabase.from("hcp_sponsorships").delete().eq("source", "nexora");
  if (payload.length > 0) {
    const { error: insertError } = await supabase.from("hcp_sponsorships").insert(payload);
    if (insertError) {
      return NextResponse.json({ error: `Écriture : ${insertError.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({ synced: payload.length });
}
