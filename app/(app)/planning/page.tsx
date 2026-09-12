import { PageContent } from "@/components/layout/PageShell";
import { PilotageBoard } from "@/components/pilotage/PilotageBoard";
import { createClient } from "@/lib/supabase/server";
import { buildProbabilityModel } from "@/lib/probability";
import {
  getAccountProducts,
  getAccounts,
  getForecasts,
  getHcps,
  getMonthlySales,
  getPlanningEvents,
  getPurchaseLines,
  getSectorObjectives,
} from "@/lib/data/queries";

export const dynamic = "force-dynamic";

export default async function PilotagePage() {
  const supabase = await createClient();

  const [accounts, forecasts, monthlySales, hcps, products, sectorObjectives, purchaseLines, planningEvents] = await Promise.all([
    getAccounts(supabase),
    getForecasts(supabase, "prevision"),
    getMonthlySales(supabase),
    getHcps(supabase),
    getAccountProducts(supabase),
    getSectorObjectives(supabase),
    getPurchaseLines(supabase),
    getPlanningEvents(supabase),
  ]);

  // Modèle à 1 mois, appris ici plutôt que dans le navigateur : une seule
  // fois par chargement, et rien à sérialiser d'autre que ses poids. Les
  // prévisions saisies à la main y entrent comme critère (« vous l'aviez
  // prévu ») — le tableau, lui, projette chaque mois avec l'état courant.
  const { weights, platt } = buildProbabilityModel({ accounts, monthlySales, purchaseLines, forecasts, horizon: 1 });

  return (
    <PageContent>
      <p className="text-sm text-muted-foreground">
        Choisissez le mois, glissez les opportunités, saisissez vos prévisions : chaque prévision nourrit le modèle
        de prédiction des mois suivants, et celles sans rendez-vous sont signalées.
      </p>
      <PilotageBoard
        accounts={accounts}
        initialForecasts={forecasts}
        monthlySales={monthlySales}
        hcps={hcps}
        products={products}
        sectorObjectives={sectorObjectives}
        purchaseLines={purchaseLines}
        planningEvents={planningEvents}
        probabilityModel={{ weights, platt }}
      />
    </PageContent>
  );
}
