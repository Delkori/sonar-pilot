import { TopBar } from "@/components/layout/TopBar";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { createClient } from "@/lib/supabase/server";
import type { Account } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: accountsRaw } = await supabase.from("accounts").select("*");
  const accounts = (accountsRaw ?? []) as Account[];

  const { data: monthlyRaw } = await supabase
    .from("account_monthly_sales")
    .select("account_id, year, month, ca");
  const monthlySales = monthlyRaw ?? [];

  const { data: productsRaw } = await supabase
    .from("account_products")
    .select("account_id, brand, sales_value_ly, sales_value_cy, growth_rate_pct");
  const products = productsRaw ?? [];

  const { data: forecastsRaw } = await supabase
    .from("account_forecasts")
    .select("account_id, year, month, boites_prevues, ca_prevu")
    .eq("kind", "prevision");
  const forecasts = forecastsRaw ?? [];

  // Objectifs du secteur (saisis dans Paramètres) — mappés au format attendu
  // par le dashboard pour alimenter le graphique Objectif vs Réalisé.
  const { data: sectorObjRaw } = await supabase.from("sector_objectives").select("*");
  const objectifs = (sectorObjRaw ?? []).map((o) => ({
    account_id: "",
    year: o.year as number,
    month: o.month as number,
    boites_prevues: o.objectif_boites as number,
    ca_prevu: o.objectif_ca as number,
  }));

  const lastImport = await supabase
    .from("imports")
    .select("imported_at, filename")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastImportLabel = lastImport.data
    ? `Dernière mise à jour : ${new Date(lastImport.data.imported_at).toLocaleString("fr-FR")} (${lastImport.data.filename})`
    : "Aucun import réalisé pour le moment — rendez-vous dans Import";

  return (
    <div>
      <TopBar title="Dashboard — Secteur Auvergne-Rhône-Alpes" />
      <DashboardClient
        accounts={accounts}
        monthlySales={monthlySales}
        products={products}
        forecasts={forecasts}
        objectifs={objectifs}
        lastImportLabel={lastImportLabel}
      />
    </div>
  );
}
