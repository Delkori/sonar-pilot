import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildIcsCalendar } from "@/lib/ics";
import type { IcsEvent } from "@/lib/ics";

export const runtime = "nodejs";

/**
 * Flux calendrier public au sens Apple Calendar (aucune session possible
 * pour un abonnement iPhone) — protégé par un jeton opaque dans l'URL
 * plutôt que par l'authentification normale de l'app.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Jeton manquant" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: tokenRow } = await supabase
    .from("calendar_feed_tokens")
    .select("token")
    .eq("token", token)
    .maybeSingle();

  if (!tokenRow) {
    return NextResponse.json({ error: "Jeton invalide" }, { status: 401 });
  }

  const { data: accountsRaw } = await supabase.from("accounts").select("id, name");
  const nameById = new Map((accountsRaw ?? []).map((a) => [a.id, a.name] as const));

  const events: IcsEvent[] = [];

  const { data: actions } = await supabase
    .from("account_actions")
    .select("id, account_id, type, content, due_date, done")
    .not("due_date", "is", null)
    .eq("done", false);

  for (const a of actions ?? []) {
    const accountName = nameById.get(a.account_id) ?? "Compte";
    events.push({
      uid: `action-${a.id}`,
      title: `${a.type === "relance" ? "Relance" : "Action"} — ${accountName}`,
      description: a.content,
      date: a.due_date as unknown as string,
      url: `${req.nextUrl.origin}/comptes/${a.account_id}`,
    });
  }

  const { data: forecasts } = await supabase
    .from("account_forecasts")
    .select("id, account_id, year, month, boites_prevues, ca_prevu, note")
    .eq("kind", "prevision");

  for (const f of forecasts ?? []) {
    const accountName = nameById.get(f.account_id) ?? "Compte";
    const date = `${f.year}-${String(f.month).padStart(2, "0")}-01`;
    events.push({
      uid: `forecast-${f.id}`,
      title: `Prévisionnel — ${accountName}`,
      description: [
        f.boites_prevues ? `${f.boites_prevues} boîtes prévues` : null,
        f.ca_prevu ? `${f.ca_prevu} € prévus` : null,
        f.note,
      ]
        .filter(Boolean)
        .join(" — "),
      date,
      url: `${req.nextUrl.origin}/comptes/${f.account_id}`,
    });
  }

  const ics = buildIcsCalendar(events, "Sonar Pilot");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="sonar-pilot.ics"',
    },
  });
}
