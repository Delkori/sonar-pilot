import { WeeklyPlanner } from "@/components/relances/WeeklyPlanner";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getActions, getForecasts, getPlanningEvents } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

export default async function SemainePage() {
  const supabase = await createClient();

  const [accounts, actions, forecasts, events] = await Promise.all([
    getAccounts(supabase),
    getActions(supabase, ["relance", "action"]),
    getForecasts(supabase, "prevision"),
    getPlanningEvents(supabase),
  ]);

  return <WeeklyPlanner initialEvents={events} accounts={accounts} forecasts={forecasts} actions={actions} />;
}
