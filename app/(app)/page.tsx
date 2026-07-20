import { TopBar } from "@/components/layout/TopBar";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { createClient } from "@/lib/supabase/server";
import type { Account } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: accountsRaw } = await supabase.from("accounts").select("*");
  const accounts = (accountsRaw ?? []) as Account[];

  const { data: monthlyRaw } = await supabase
    .from("account_monthly_sales")
    .select("account_id, year, month, ca");
  const monthlySales = monthlyRaw ?? [];

  const lastImport = await supabase
    .from("imports")
    .select("imported_at, filename")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastImportLabel = lastImport.data
    ? `Dernière mise à jour : ${new Date(lastImport.data.imported_at).toLocaleString("fr-FR")} (${lastImport.data.filename})`
    : "Aucun import réalisé pour le moment — rendez-vous dans Import";

  return (
    <div>
      <TopBar title="Dashboard — Secteur Auvergne-Rhône-Alpes" />
      <DashboardClient accounts={accounts} monthlySales={monthlySales} lastImportLabel={lastImportLabel} />
    </div>
  );
}
