import { PageShell } from "@/components/layout/PageShell";
import { ProbabilityClient } from "@/components/probabilites/ProbabilityClient";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getMonthlySales, getPurchaseLines } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

export default async function ProbabilitesPage() {
  const supabase = await createClient();
  const [accounts, monthlySales, purchaseLines] = await Promise.all([
    getAccounts(supabase),
    getMonthlySales(supabase),
    getPurchaseLines(supabase),
  ]);

  return (
    <PageShell
      title="Probabilités de commande"
      subtitle="Chances qu'un compte commande dans les prochains mois, apprises sur l'historique réel du portefeuille — critère par critère, avec la fiabilité mesurée"
    >
      <ProbabilityClient accounts={accounts} monthlySales={monthlySales} purchaseLines={purchaseLines} />
    </PageShell>
  );
}
