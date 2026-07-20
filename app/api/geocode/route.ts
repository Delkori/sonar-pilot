import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Géocode les comptes qui ont ville/code postal mais pas encore de
 * latitude/longitude, via l'API Adresse du gouvernement français (gratuite,
 * sans clé). Les coordonnées sont stockées en base pour ne jamais avoir à
 * regéocoder à chaque affichage de la carte.
 */
export async function POST() {
  const supabase = createAdminClient();

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, city, postal_code")
    .is("latitude", null)
    .not("postal_code", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ geocoded: 0, failed: 0 });
  }

  let geocoded = 0;
  let failed = 0;

  for (const account of accounts) {
    const query = [account.city, account.postal_code].filter(Boolean).join(" ");
    try {
      const res = await fetch(
        `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&postcode=${account.postal_code}&limit=1`
      );
      const json = await res.json();
      const feature = json?.features?.[0];
      if (feature) {
        const [longitude, latitude] = feature.geometry.coordinates;
        await supabase
          .from("accounts")
          .update({ latitude, longitude, geocoded_at: new Date().toISOString() })
          .eq("id", account.id);
        geocoded++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ geocoded, failed, total: accounts.length });
}
