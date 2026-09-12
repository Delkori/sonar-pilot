import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Recherche de comptes pour la barre de recherche globale : nom, code SAP
 * ou ville. Passe par le client serveur (cookies de session) : la RLS
 * s'applique, un visiteur non authentifié n'obtient rien — et le
 * middleware l'a de toute façon déjà renvoyé vers /login.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("q") ?? "";
  // Le filtre `or` de PostgREST est une mini-grammaire : virgules,
  // parenthèses et jokers dans la saisie casseraient la requête ou
  // élargiraient la recherche à l'insu de l'utilisateur.
  const q = raw.replace(/[%_,()*\\]/g, " ").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const supabase = await createClient();
  const motif = `%${q}%`;
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, city, postal_code, segment, status")
    .or(`name.ilike.${motif},external_ref.ilike.${motif},city.ilike.${motif}`)
    .order("name")
    .limit(8);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ results: data ?? [] });
}
