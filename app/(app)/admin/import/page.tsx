import { TopBar } from "@/components/layout/TopBar";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { ImportForm } from "@/components/admin/ImportForm";
import { ImportLogsTable } from "@/components/admin/ImportLogsTable";
import { createClient } from "@/lib/supabase/server";
import type { Import } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ImportAdminPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("imports").select("*").order("imported_at", { ascending: false }).limit(20);
  const imports = (data ?? []) as Import[];

  return (
    <div>
      <TopBar title="Import / Admin" subtitle="Mettre à jour les données depuis le PAS Excel" />
      <main className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-[1fr_1.2fr]">
        <ImportForm />

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Historique des imports</CardTitle>
            <CardDescription>Traçabilité complète — aucun import n&apos;écrase silencieusement les données précédentes.</CardDescription>
          </CardHeader>
          <ImportLogsTable imports={imports} />
        </Card>
      </main>
    </div>
  );
}
