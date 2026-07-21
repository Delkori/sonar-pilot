import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNexoraClient } from "@/lib/supabase/nexora";

/**
 * Synchronise les médecins et leur sponsoring depuis le projet Supabase
 * "nexora" (table prospects_structures : match_medecin_nom = "NOM — Spécialité",
 * match_medecin_key = "RPPS:xxxx", match_labo, match_montant, nom = structure,
 * departement) vers notre table hcp_sponsorships. Remplacement complet des
 * lignes source='nexora' à chaque appel. On garde toutes les lignes ayant un
 * médecin (même sans labo) pour repérer les médecins absents du Salesforce ;
 * le rapprochement se fait via le RPPS côté fiche compte / page Sponsoring.
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
    .select("nom, departement, match_medecin_nom, match_medecin_key, match_labo, match_montant")
    .not("match_medecin_nom", "is", null);

  if (error) {
    return NextResponse.json({ error: `Lecture Nexora : ${error.message}` }, { status: 500 });
  }

  type Row = {
    nom: string | null;
    departement: string | null;
    match_medecin_nom: string | null;
    match_medecin_key: string | null;
    match_labo: string | null;
    match_montant: number | null;
  };

  const payload = ((data ?? []) as Row[])
    .filter((r) => r.match_medecin_nom)
    .map((r) => {
      // "LUDOVIC LIEVAIN — Chirurgie plastique..." -> nom + spécialité
      const [namePart, ...specParts] = (r.match_medecin_nom as string).split("—");
      return {
        rpps: r.match_medecin_key ? r.match_medecin_key.replace(/^RPPS:/i, "").replace(/\s/g, "") : null,
        hcp_name: namePart.trim(),
        specialite: specParts.length ? specParts.join("—").trim() : null,
        laboratoire: r.match_labo,
        montant: r.match_montant,
        structure_nom: r.nom,
        departement: r.departement,
        source: "nexora",
      };
    });

  const supabase = createAdminClient();
  await supabase.from("hcp_sponsorships").delete().eq("source", "nexora");
  if (payload.length > 0) {
    const { error: insertError } = await supabase.from("hcp_sponsorships").insert(payload);
    if (insertError) {
      return NextResponse.json({ error: `Écriture : ${insertError.message}` }, { status: 500 });
    }
  }

  const avecLabo = payload.filter((p) => p.laboratoire).length;
  return NextResponse.json({ synced: payload.length, avecLabo });
}
