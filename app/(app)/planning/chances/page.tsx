import Link from "next/link";
import { PageContent } from "@/components/layout/PageShell";
import { ProbabilityClient } from "@/components/probabilites/ProbabilityClient";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getForecasts, getMonthlySales, getPurchaseLines } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

/**
 * Qui va commander, et quand : le classement des comptes par chance de
 * commande sur 1, 3 ou 6 mois. C'est la matière première du mois à
 * planifier — d'où sa place dans Planning, à côté du prévisionnel qu'il
 * alimente (chaque carte du mois affiche la même chance).
 */
export default async function ChancesPage() {
  const supabase = await createClient();
  const [accounts, monthlySales, purchaseLines, forecasts] = await Promise.all([
    getAccounts(supabase),
    getMonthlySales(supabase),
    getPurchaseLines(supabase),
    getForecasts(supabase, "prevision"),
  ]);

  return (
    <PageContent>
      <p className="text-sm text-muted-foreground">
        Chances qu&apos;un compte commande dans les prochains mois, apprises sur l&apos;historique réel du portefeuille —
        critère par critère, avec la fiabilité mesurée. Ce sont ces chances que le prévisionnel du mois utilise.
      </p>
      <ProbabilityClient accounts={accounts} monthlySales={monthlySales} purchaseLines={purchaseLines} forecasts={forecasts} />
      <p className="text-xs text-muted-foreground">
        Outil avancé :{" "}
        <Link href="/planning/chances/sonarscore" className="text-primary hover:underline">
          SonarScore (bêta)
        </Link>{" "}
        — scoring comportemental RFM-S, vélocités de réapprovisionnement et backtest du générateur.
      </p>
    </PageContent>
  );
}
