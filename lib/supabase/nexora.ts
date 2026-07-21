import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Client du projet Supabase "nexora" (base Transparence Santé, ~230k
 * médecins). Sert à interroger les fonctions RPC sonar_* en lecture seule.
 * Les RPC sont accessibles avec la clé anon (droits accordés à anon), donc
 * une clé anon suffit ; la service role est acceptée aussi.
 * Variables d'environnement (Vercel) :
 *   NEXORA_SUPABASE_URL
 *   NEXORA_SUPABASE_ANON_KEY   (ou NEXORA_SUPABASE_SERVICE_ROLE_KEY)
 * Renvoie null si non configuré.
 */
export function createNexoraClient() {
  const url = process.env.NEXORA_SUPABASE_URL;
  const key =
    process.env.NEXORA_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXORA_SUPABASE_ANON_KEY ||
    process.env.NEXORA_SUPABASE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false } });
}
