import { TopBar } from "@/components/layout/TopBar";
import { PilotageBoard } from "@/components/pilotage/PilotageBoard";
import { createClient } from "@/lib/supabase/server";
import type { Account, AccountForecast, AccountProductPurchase, Hcp, SectorObjective } from "@/types/database";

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
    .select("account_id, brand, sales_value_ly, sales_value_cy, qty_ordered_cy");
  const products = (productsRaw ?? []) as {
    account_id: string;
    brand: string;
    sales_value_ly: number | null;
    sales_value_cy: number | null;
    qty_ordered_cy: number | null;
  }[];

  const { data: objRaw } = await supabase.from("sector_objectives").select("*");
  const sectorObjectives = (objRaw ?? []) as SectorObjective[];

  const { data: purchasesRaw } = await supabase
    .from("account_product_purchases")
    .select("account_id, brand, purchase_date, qty");
  const purchaseLines = (purchasesRaw ?? []) as Pick<
    AccountProductPurchase,
    "account_id" | "brand" | "purchase_date" | "qty"
  >[];

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
          purchaseLines={purchaseLines}
        />
      </main>
    </div>
  );
}
