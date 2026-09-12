import { PageContent } from "@/components/layout/PageShell";
import { PilotageBoard } from "@/components/pilotage/PilotageBoard";
import { createClient } from "@/lib/supabase/server";
import {
  getAccountProducts,
  getAccounts,
  getForecasts,
  getHcps,
  getMonthlySales,
  getPurchaseLines,
  getSectorObjectives,
} from "@/lib/data/queries";

export const dynamic = "force-dynamic";

export default async function PilotagePage() {
  const supabase = await createClient();

  const [accounts, forecasts, monthlySales, hcps, products, sectorObjectives, purchaseLines] = await Promise.all([
    getAccounts(supabase),
    getForecasts(supabase, "prevision"),
    getMonthlySales(supabase),
    getHcps(supabase),
    getAccountProducts(supabase),
    getSectorObjectives(supabase),
    getPurchaseLines(supabase),
  ]);

  return (
    <PageContent>
      <p className="text-sm text-muted-foreground">Opportunités à glisser dans les mois, prévisionnel généré ou saisi, suivi prévu / réalisé.</p>
      <PilotageBoard
        accounts={accounts}
        initialForecasts={forecasts}
        monthlySales={monthlySales}
        hcps={hcps}
        products={products}
        sectorObjectives={sectorObjectives}
        purchaseLines={purchaseLines}
      />
    </PageContent>
  );
}
