import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetchAll";
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
    .select("token, sector_id")
    .eq("token", token)
    .maybeSingle();

  if (!tokenRow) {
    return NextResponse.json({ error: "Jeton invalide" }, { status: 401 });
  }
  // Client service-role : contourne RLS, donc chaque requête ci-dessous
  // filtre elle-même par le secteur du jeton — sans quoi ce flux mélangerait
  // les comptes/actions/prévisions/planning de tous les secteurs.
  const sectorId = tokenRow.sector_id;

  // Quatre lectures indépendantes, désormais en parallèle et paginées : au
  // delà de 1000 lignes, les pages suivantes d'actions/prévisions/événements
  // étaient purement et simplement absentes du flux.
  type AccountLite = { id: string; name: string; last_order_date: string | null; potentiel_boites: number | null };
  type ActionLite = { id: string; account_id: string; type: string; content: string; due_date: string | null };
  type ForecastLite = {
    id: string;
    account_id: string;
    year: number;
    month: number;
    boites_prevues: number | null;
    ca_prevu: number | null;
    note: string | null;
  };
  type PlanningLite = {
    id: string;
    account_id: string | null;
    type: string;
    title: string | null;
    note: string | null;
    start_at: string;
    end_at: string;
  };

  const [accountsRaw, actions, forecasts, planningEvents] = await Promise.all([
    fetchAll<AccountLite>(() =>
      supabase.from("accounts").select("id, name, last_order_date, potentiel_boites").eq("sector_id", sectorId)
    ),
    fetchAll<ActionLite>(() =>
      supabase
        .from("account_actions")
        .select("id, account_id, type, content, due_date")
        .eq("sector_id", sectorId)
        .not("due_date", "is", null)
        .eq("done", false)
    ),
    fetchAll<ForecastLite>(() =>
      supabase
        .from("account_forecasts")
        .select("id, account_id, year, month, boites_prevues, ca_prevu, note")
        .eq("sector_id", sectorId)
        .eq("kind", "prevision")
    ),
    fetchAll<PlanningLite>(() =>
      supabase
        .from("planning_events")
        .select("id, account_id, type, title, note, start_at, end_at")
        .eq("sector_id", sectorId)
    ),
  ]);

  const accountById = new Map(accountsRaw.map((a) => [a.id, a] as const));

  const events: IcsEvent[] = [];

  for (const a of actions) {
    const accountName = accountById.get(a.account_id)?.name ?? "Compte";
    events.push({
      uid: `action-${a.id}`,
      title: `${a.type === "relance" ? "Relance" : "Action"} — ${accountName}`,
      description: a.content,
      date: a.due_date as unknown as string,
      url: `${req.nextUrl.origin}/comptes/${a.account_id}`,
    });
  }

  for (const f of forecasts) {
    const accountName = accountById.get(f.account_id)?.name ?? "Compte";
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

  // Prévision la plus importante par compte, réutilisée pour enrichir les
  // événements de planning — la même requête était exécutée une seconde fois
  // juste pour cela.
  const forecastByAccount = new Map<string, ForecastLite>();
  for (const f of forecasts) {
    const cur = forecastByAccount.get(f.account_id);
    if (!cur || (f.ca_prevu ?? 0) > (cur.ca_prevu ?? 0)) forecastByAccount.set(f.account_id, f);
  }

  const TYPE_LABEL: Record<string, string> = {
    visite: "Visite",
    visite_prospect: "Prospection",
    appel: "Appels",
    admin: "Administratif",
  };

  for (const p of planningEvents) {
    const account = p.account_id ? accountById.get(p.account_id) : null;
    const forecast = p.account_id ? forecastByAccount.get(p.account_id) : null;
    const descParts = [
      p.note,
      forecast ? `Prévisionnel : ${forecast.boites_prevues ?? 0} boîtes · ${Math.round(forecast.ca_prevu ?? 0)} €` : null,
      account?.last_order_date
        ? `Dernière commande : ${new Date(account.last_order_date).toLocaleDateString("fr-FR")}`
        : null,
    ].filter(Boolean);
    events.push({
      uid: `planning-${p.id}`,
      title: `${TYPE_LABEL[p.type] ?? p.type}${account ? ` — ${account.name}` : ""}`,
      description: descParts.join("\n"),
      start: p.start_at,
      end: p.end_at,
      url: account ? `${req.nextUrl.origin}/comptes/${account.id}` : undefined,
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
