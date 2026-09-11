import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetchAll";

export const runtime = "nodejs";
// Le géocodage est un traitement de lot : la limite par défaut de la
// plateforme (10 s en hobby) coupait l'opération en plein milieu, laissant
// une partie des comptes sans coordonnées et sans message d'erreur.
export const maxDuration = 60;

/**
 * Géocode les comptes qui ont ville/code postal mais pas encore de
 * latitude/longitude, via l'API Adresse du gouvernement français (gratuite,
 * sans clé). Les coordonnées sont stockées en base pour ne jamais avoir à
 * regéocoder à chaque affichage de la carte.
 *
 * Trois problèmes corrigés par rapport à la version séquentielle :
 * - un aller-retour HTTP par compte, en série : plusieurs minutes pour un
 *   secteur complet, donc un timeout systématique côté plateforme ;
 * - un `update` Supabase par compte, en série également ;
 * - aucune borne de temps : la réponse ne disait pas si le lot était
 *   terminé, alors qu'un appel interrompu laissait un travail à reprendre.
 *
 * La concurrence est volontairement basse (5) : l'API Adresse est un
 * service public gratuit, la saturer se solderait par un blocage d'IP.
 */
const CONCURRENCY = 5;
const BUDGET_MS = 45_000;

type PendingAccount = { id: string; city: string | null; postal_code: string | null };
type Geocoded = { id: string; latitude: number; longitude: number };

async function geocodeOne(account: PendingAccount): Promise<Geocoded | null> {
  const query = [account.city, account.postal_code].filter(Boolean).join(" ");
  if (!query) return null;
  try {
    const res = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&postcode=${account.postal_code}&limit=1`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const feature = json?.features?.[0];
    if (!feature) return null;
    const [longitude, latitude] = feature.geometry.coordinates;
    return { id: account.id, latitude, longitude };
  } catch {
    return null;
  }
}

export async function POST() {
  const supabase = await createClient();

  let pending: PendingAccount[];
  try {
    pending = await fetchAll<PendingAccount>(() =>
      supabase.from("accounts").select("id, city, postal_code").is("latitude", null).not("postal_code", "is", null)
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lecture des comptes impossible" }, { status: 500 });
  }

  if (pending.length === 0) {
    return NextResponse.json({ geocoded: 0, failed: 0, total: 0, remaining: 0, done: true });
  }

  const startedAt = Date.now();
  const results: Geocoded[] = [];
  let failed = 0;
  let processed = 0;

  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > BUDGET_MS) break;
    const batch = pending.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(batch.map(geocodeOne));
    processed += batch.length;
    for (const r of settled) {
      if (r) results.push(r);
      else failed++;
    }
  }

  // Les écritures restaient elles aussi en série. Un `upsert` groupé n'est
  // pas possible ici (il insérerait des lignes incomplètes si l'id n'existait
  // pas : `name`/`external_ref` sont NOT NULL) — on parallélise donc les
  // `update`, ciblés sur la seule ligne concernée.
  const geocodedAt = new Date().toISOString();
  for (let i = 0; i < results.length; i += CONCURRENCY) {
    await Promise.all(
      results.slice(i, i + CONCURRENCY).map((r) =>
        supabase
          .from("accounts")
          .update({ latitude: r.latitude, longitude: r.longitude, geocoded_at: geocodedAt })
          .eq("id", r.id)
      )
    );
  }

  const remaining = pending.length - processed;
  return NextResponse.json({
    geocoded: results.length,
    failed,
    total: pending.length,
    remaining,
    done: remaining === 0,
  });
}
