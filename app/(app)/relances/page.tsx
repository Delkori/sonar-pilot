import { headers } from "next/headers";
import { PageShell } from "@/components/layout/PageShell";
import { WeeklyPlanner } from "@/components/relances/WeeklyPlanner";
import { CalendarSyncPanel } from "@/components/relances/CalendarSyncPanel";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { getAccounts, getActions, getForecasts } from "@/lib/data/queries";
import type { PlanningEvent } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function RelancesPage() {
  const supabase = await createClient();

  const [accounts, actions, forecasts, events, tokenRes, hdrs] = await Promise.all([
    getAccounts(supabase),
    getActions(supabase, ["relance", "action"]),
    getForecasts(supabase, "prevision"),
    fetchAll<PlanningEvent>(() => supabase.from("planning_events").select("*"), { orderBy: "start_at" }),
    supabase.from("calendar_feed_tokens").select("token").limit(1).maybeSingle(),
    headers(),
  ]);

  const host = hdrs.get("host");
  const proto = host?.includes("localhost") ? "http" : "https";
  const feedUrl = tokenRes.data ? `${proto}://${host}/api/calendar.ics?token=${tokenRes.data.token}` : null;

  return (
    <PageShell
      title="Planning hebdomadaire"
      subtitle="Visites clients & prospects, appels et temps administratif — glissez un compte dans le calendrier"
      actions={feedUrl ? <CalendarSyncPanel feedUrl={feedUrl} /> : undefined}
      bare
    >
      <WeeklyPlanner initialEvents={events} accounts={accounts} forecasts={forecasts} actions={actions} />
    </PageShell>
  );
}
