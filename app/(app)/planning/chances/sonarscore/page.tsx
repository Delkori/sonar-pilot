import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageContent } from "@/components/layout/PageShell";
import { SonarScoreClient } from "@/components/sonarscore/SonarScoreClient";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getPurchaseLines } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

/**
 * Outil avancé, hors onglets : le SonarScore (bêta) coexiste avec le score
 * de ciblage et le modèle de probabilité. On y accède depuis Chances.
 */
export default async function SonarScorePage() {
  const supabase = await createClient();
  const [accounts, purchases] = await Promise.all([getAccounts(supabase), getPurchaseLines(supabase)]);

  return (
    <PageContent>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Scoring comportemental (bêta) — RFM-S, vélocités de réapprovisionnement, matrice contrat et prévision
          d&apos;achat, en coexistence avec le score de ciblage et les chances de commande.
        </p>
        <Link
          href="/planning/chances"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
        >
          <ArrowLeft size={15} /> Chances de commande
        </Link>
      </div>
      <SonarScoreClient accounts={accounts} purchases={purchases} />
    </PageContent>
  );
}
