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
    <>
      <Card className="overflow-hidden">
        <AccountsTable
          accounts={accounts}
          recurrence={recurrence}
          monthlySales={monthlySales}
          initialTier={tier ?? "all"}
          initialRecurrence={recuParam ?? "all"}
        />
      </Card>
    </>
  );
}
