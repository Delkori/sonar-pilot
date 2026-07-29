import { TopBar } from "@/components/layout/TopBar";
import { WeeklyPlanner } from "@/components/relances/WeeklyPlanner";
import { CalendarSyncPanel } from "@/components/relances/CalendarSyncPanel";
import { createClient } from "@/lib/supabase/server";
import type { Account, AccountAction, AccountForecast, PlanningEvent } from "@/types/database";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function RelancesPage() {
  const supabase = await createClient();

  const { data: accountsRaw } = await supabase.from("accounts").select("*");
  const accounts = (accountsRaw ?? []) as Account[];

  const { data: actionsRaw } = await supabase
    .from("account_actions")
    .select("*")
    .in("type", ["relance", "action"]);
  const actions = (actionsRaw ?? []) as AccountAction[];

  const { data: forecastsRaw } = await supabase
    .from("account_forecasts")
    .select("*")
    .eq("kind", "prevision");
  const forecasts = (forecastsRaw ?? []) as AccountForecast[];

  const { data: eventsRaw } = await supabase.from("planning_events").select("*");
  const events = (eventsRaw ?? []) as PlanningEvent[];

  const { data: tokenRow } = await supabase.from("calendar_feed_tokens").select("token").limit(1).maybeSingle();
  const hdrs = await headers();
  const host = hdrs.get("host");
  const proto = host?.includes("localhost") ? "http" : "https";
  const feedUrl = tokenRow ? `${proto}://${host}/api/calendar.ics?token=${tokenRow.token}` : null;

  return (
    <div>
      <TopBar
        title="Planning hebdomadaire"
        subtitle="Visites clients & prospects, appels et temps administratif — glissez un compte dans le calendrier"
      />
      <div className="flex justify-end px-8 pt-3">
        {feedUrl && <CalendarSyncPanel feedUrl={feedUrl} />}
      </div>
      <WeeklyPlanner initialEvents={events} accounts={accounts} forecasts={forecasts} actions={actions} />
    </div>
  );
}
