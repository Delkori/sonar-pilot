import { TopBar } from "@/components/layout/TopBar";
import { WeeklyPlanner } from "@/components/relances/WeeklyPlanner";
import { createClient } from "@/lib/supabase/server";
import type { Account, AccountAction, AccountForecast, PlanningEvent } from "@/types/database";

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

  return (
    <div>
      <TopBar
        title="Planning hebdomadaire"
        subtitle="Visites clients & prospects, appels et temps administratif — glissez un compte dans le calendrier"
      />
      <WeeklyPlanner initialEvents={events} accounts={accounts} forecasts={forecasts} actions={actions} />
    </div>
  );
}
