import { TopBar } from "@/components/layout/TopBar";
import { PilotageBoard } from "@/components/pilotage/PilotageBoard";
import { createClient } from "@/lib/supabase/server";
import type { Account, AccountForecast } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function PilotagePage() {
  const supabase = await createClient();

  const { data: accountsRaw } = await supabase.from("accounts").select("*");
  const accounts = (accountsRaw ?? []) as Account[];

  const { data: forecastsRaw } = await supabase.from("account_forecasts").select("*");
  const forecasts = (forecastsRaw ?? []) as AccountForecast[];

  const { data: monthlyRaw } = await supabase
    .from("account_monthly_sales")
    .select("account_id, year, month, ca");
  const monthlySales = monthlyRaw ?? [];

  const { data: productsRaw } = await supabase
    .from("account_products")
    .select("account_id, brand, qty_ordered_cy");
  const products = productsRaw ?? [];

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
          products={products}
        />
      </main>
    </div>
  );
}
