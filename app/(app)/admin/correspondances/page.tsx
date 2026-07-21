import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/Card";
import { MatchReviewPanel } from "@/components/admin/MatchReviewPanel";
import { createClient } from "@/lib/supabase/server";
import type { Account, NameMatchCandidate } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function CorrespondancesPage() {
  const supabase = await createClient();

  const { data: candidatesRaw } = await supabase
    .from("name_match_candidates")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  const candidates = (candidatesRaw ?? []) as NameMatchCandidate[];

  const { data: accountsRaw } = await supabase.from("accounts").select("*").order("name");
  const accounts = (accountsRaw ?? []) as Account[];

  return (
    <div>
      <TopBar
        title="Correspondances à valider"
        subtitle="Noms de facture qui ne correspondent pas clairement à un compte du référentiel — confirmez le bon compte, puis relancez l'import pour appliquer les données"
      />
      <main className="px-8 py-6">
        <Card className="overflow-hidden">
          <MatchReviewPanel candidates={candidates} accounts={accounts} />
        </Card>
      </main>
    </div>
  );
}
