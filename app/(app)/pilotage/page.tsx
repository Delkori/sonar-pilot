import { TopBar } from "@/components/layout/TopBar";
import { PilotageBoard } from "@/components/pilotage/PilotageBoard";
import { createClient } from "@/lib/supabase/server";
import type { Account, AccountForecast, Hcp, SectorObjective } from "@/types/database";

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

  const { data: productsRaw } = await supabase
    .from("account_products")
    .select("brand, sales_value_ly, sales_value_cy");
  const products = (productsRaw ?? []) as { brand: string; sales_value_ly: number | null; sales_value_cy: number | null }[];

  const { data: objRaw } = await supabase.from("sector_objectives").select("*");
  const sectorObjectives = (objRaw ?? []) as SectorObjective[];

  return (
    <div>
      <TopBar
        title="Pilotage"
        subtitle="Planifiez le secteur : dashboard, opportunités à glisser dans les mois, suivi prévu/réalisé"
      />
      <main className="px-8 py-6">
        <PilotageBoard
          accounts={accounts}
          initialForecasts={forecasts}
          monthlySales={monthlySales}
          hcps={hcps}
          products={products}
          sectorObjectives={sectorObjectives}
        />
      </main>
    </div>
  );
}
