import { TopBar } from "@/components/layout/TopBar";
import { PilotageBoard } from "@/components/pilotage/PilotageBoard";
import { createClient } from "@/lib/supabase/server";
import type { Account, AccountForecast, Hcp } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function PilotagePage() {
  const supabase = await createClient();

  const { data: accountsRaw } = await supabase.from("accounts").select("*");
  const accounts = (accountsRaw ?? []) as Account[];

  const { data: forecastsRaw } = await supabase.from("account_forecasts").select("*").eq("kind", "prevision");
  const forecasts = (forecastsRaw ?? []) as AccountForecast[];

  const { data: monthlyRaw } = await supabase
    .from("account_monthly_sales")
    .select("account_id, year, month, ca");
  const monthlySales = monthlyRaw ?? [];

  const { data: hcpsRaw } = await supabase.from("hcps").select("id, account_id, name, potentiel_boites");
  const hcps = (hcpsRaw ?? []) as Pick<Hcp, "id" | "account_id" | "name" | "potentiel_boites">[];

  return (
    <div>
      <TopBar
        title="Pilotage"
        subtitle="Glissez les opportunités dans un mois pour construire votre plan — le suivi prévu/réalisé se met à jour à chaque import"
      />
      <main className="px-8 py-6">
        <PilotageBoard
          accounts={accounts}
          initialForecasts={forecasts}
          monthlySales={monthlySales}
          hcps={hcps}
        />
      </main>
    </div>
  );
}
