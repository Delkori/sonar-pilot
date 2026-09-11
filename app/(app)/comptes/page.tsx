import { PageShell } from "@/components/layout/PageShell";
import { Card } from "@/components/ui/Card";
import { AccountsTable } from "@/components/comptes/AccountsTable";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getMonthlySales } from "@/lib/data/queries";
import { recurrenceByAccount } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function ComptesPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; recurrence?: string }>;
}) {
  const { tier, recurrence: recuParam } = await searchParams;
  const supabase = await createClient();

  const [accounts, monthlySales] = await Promise.all([getAccounts(supabase), getMonthlySales(supabase)]);
  const recurrence = Object.fromEntries(recurrenceByAccount(monthlySales));

  return (
    <PageShell title="Comptes" subtitle={`${accounts.length} compte(s) — secteur Auvergne-Rhône-Alpes`}>
      <Card className="overflow-hidden">
        <AccountsTable
          accounts={accounts}
          recurrence={recurrence}
          initialTier={tier ?? "all"}
          initialRecurrence={recuParam ?? "all"}
        />
      </Card>
    </PageShell>
  );
}
