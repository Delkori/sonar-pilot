import { SonarScoreClient } from "@/components/sonarscore/SonarScoreClient";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getPurchaseLines } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

export default async function SonarScorePage() {
  const supabase = await createClient();
  const [accounts, purchases] = await Promise.all([getAccounts(supabase), getPurchaseLines(supabase)]);

  return (
    <>
      <p className="text-sm text-muted-foreground">Scoring comportemental (bêta) — RFM-S, vélocités de réapprovisionnement, matrice contrat et prévision d&apos;achat, en coexistence avec le score de ciblage</p>
      <SonarScoreClient accounts={accounts} purchases={purchases} />
    </>
  );
}
