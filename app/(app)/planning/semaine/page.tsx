import { WeeklyPlanner } from "@/components/relances/WeeklyPlanner";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { getAccounts, getActions, getForecasts } from "@/lib/data/queries";
import type { PlanningEvent } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function SemainePage() {
  const supabase = await createClient();

  const [accounts, actions, forecasts, events] = await Promise.all([
    getAccounts(supabase),
    getActions(supabase, ["relance", "action"]),
    getForecasts(supabase, "prevision"),
    fetchAll<PlanningEvent>(() => supabase.from("planning_events").select("*"), { orderBy: "start_at" }),
  ]);

  return <WeeklyPlanner initialEvents={events} accounts={accounts} forecasts={forecasts} actions={actions} />;
}
