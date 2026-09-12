import { PageShell } from "@/components/layout/PageShell";
import { Card } from "@/components/ui/Card";
import { MatchReviewPanel } from "@/components/admin/MatchReviewPanel";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { getAccounts } from "@/lib/data/queries";
import type { NameMatchCandidate } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function CorrespondancesPage() {
  const supabase = await createClient();

  const [candidates, accounts] = await Promise.all([
    fetchAll<NameMatchCandidate>(
      () => supabase.from("name_match_candidates").select("*").eq("status", "pending"),
      { orderBy: "created_at", ascending: false }
    ),
    getAccounts(supabase),
  ]);

  return (
    <PageShell
      title="Correspondances à valider"
      subtitle="Noms de facture qui ne correspondent pas clairement à un compte du référentiel — confirmez le bon compte, puis relancez l'import pour appliquer les données"
    >
      <Card className="overflow-hidden">
        <MatchReviewPanel candidates={candidates} accounts={accounts} />
      </Card>
    </PageShell>
  );
}
