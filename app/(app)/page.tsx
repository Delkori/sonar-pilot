import { PageShell } from "@/components/layout/PageShell";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { createClient } from "@/lib/supabase/server";
import {
  getAccounts,
  getAccountProducts,
  getForecasts,
  getLastImportLabel,
  getMonthlySales,
  getSectorObjectives,
} from "@/lib/data/queries";
import { getCompetitorAmounts, SECTEUR_REGION } from "@/lib/nexora/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Requêtes indépendantes : en série, la page attendait la somme des
  // latences Supabase (6 aller-retours) avant le premier octet.
  const [accounts, monthlySales, products, forecasts, sectorObjectives, lastImportLabel] = await Promise.all([
    getAccounts(supabase),
    getMonthlySales(supabase),
    getAccountProducts(supabase),
    getForecasts(supabase, "prevision"),
    getSectorObjectives(supabase),
    getLastImportLabel(supabase),
  ]);

  // Objectifs du secteur (saisis dans Paramètres) — remis au format
  // attendu par le graphique Objectif vs Réalisé.
  const objectifs = sectorObjectives.map((o) => ({
    account_id: "",
    year: o.year,
    month: o.month,
    boites_prevues: o.objectif_boites,
    ca_prevu: o.objectif_ca,
  }));

  const competitorAmounts = await getCompetitorAmounts(SECTEUR_REGION);

  return (
    <PageShell title="Dashboard" subtitle="Secteur Auvergne-Rhône-Alpes">
      <DashboardClient
        accounts={accounts}
        monthlySales={monthlySales}
        products={products}
        forecasts={forecasts}
        objectifs={objectifs}
        competitorAmounts={competitorAmounts}
        lastImportLabel={lastImportLabel}
      />
    </PageShell>
  );
}
