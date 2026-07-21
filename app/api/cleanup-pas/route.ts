import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Vide les champs qui ne viennent plus que d'anciens imports PAS et ne
 * sont plus jamais rafraîchis par le nouveau pipeline (Salesforce +
 * factures) — les laisser en place donnerait une impression de données
 * à jour alors qu'elles sont figées à la date du dernier PAS importé.
 */
export async function POST() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("accounts")
    .update({
      ca_2022: null,
      ca_2023: null,
      action_recommandee: null,
      refs_manquantes: null,
      evolution_pct: null,
    })
    .not("id", "is", null)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ cleaned: data?.length ?? 0 });
}
