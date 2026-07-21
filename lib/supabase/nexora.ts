import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Client en lecture du projet Supabase "nexora" (distinct de sonar-pilot).
 * Sert uniquement à synchroniser les données de sponsoring vers notre table
 * hcp_sponsorships. Nécessite les variables d'environnement :
 *   NEXORA_SUPABASE_URL
 *   NEXORA_SUPABASE_SERVICE_ROLE_KEY   (service role : contourne la RLS)
 * Renvoie null si non configuré — l'appelant affiche alors un message clair.
 */
export function createNexoraClient() {
  const url = process.env.NEXORA_SUPABASE_URL;
  const key = process.env.NEXORA_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false } });
}
