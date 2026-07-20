import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/Card";
import { AccountsTable } from "@/components/comptes/AccountsTable";
import { createClient } from "@/lib/supabase/server";
import type { Account } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ComptesPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("accounts").select("*").order("name");
  const accounts = (data ?? []) as Account[];

  return (
    <div>
      <TopBar title="Comptes" subtitle={`${accounts.length} compte(s) — secteur Auvergne-Rhône-Alpes`} />
      <main className="px-8 py-6">
        <Card className="overflow-hidden">
          <AccountsTable accounts={accounts} />
        </Card>
      </main>
    </div>
  );
}
