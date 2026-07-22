import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/Card";
import { AccountsTable } from "@/components/comptes/AccountsTable";
import { createClient } from "@/lib/supabase/server";
import { recurrenceByAccount } from "@/lib/accounts";
import type { Account } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ComptesPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; recurrence?: string }>;
}) {
  const { tier, recurrence: recuParam } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("accounts").select("*").order("name");
  const accounts = (data ?? []) as Account[];

  const { data: monthlyRaw } = await supabase
    .from("account_monthly_sales")
    .select("account_id, year, month, ca");
  const recurrenceMap = recurrenceByAccount(monthlyRaw ?? []);
  const recurrence = Object.fromEntries(recurrenceMap);

  return (
    <div>
      <TopBar title="Comptes" subtitle={`${accounts.length} compte(s) — secteur Auvergne-Rhône-Alpes`} />
      <main className="px-8 py-6">
        <Card className="overflow-hidden">
          <AccountsTable
            accounts={accounts}
            recurrence={recurrence}
            initialTier={tier ?? "all"}
            initialRecurrence={recuParam ?? "all"}
          />
        </Card>
      </main>
    </div>
  );
}
