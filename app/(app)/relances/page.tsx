import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/Card";
import { RelancesTable } from "@/components/relances/RelancesTable";
import { createClient } from "@/lib/supabase/server";
import { getPhoneFollowUps } from "@/lib/followups";
import type { Account, AccountAction } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function RelancesPage() {
  const supabase = await createClient();

  const { data: accountsRaw } = await supabase.from("accounts").select("*");
  const accounts = (accountsRaw ?? []) as Account[];

  const { data: actionsRaw } = await supabase
    .from("account_actions")
    .select("*")
    .in("type", ["relance", "action"]);
  const actions = (actionsRaw ?? []) as AccountAction[];

  const followUps = getPhoneFollowUps(accounts, actions);

  return (
    <div>
      <TopBar
        title="Relances téléphoniques"
        subtitle="Comptes à rappeler cette semaine pour planifier une visite — silence prolongé ou action prioritaire du score de ciblage"
      />
      <main className="px-8 py-6">
        <Card className="overflow-hidden">
          <RelancesTable followUps={followUps} />
        </Card>
      </main>
    </div>
  );
}
