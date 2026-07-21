import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { ImportForm } from "@/components/admin/ImportForm";
import { ImportLogsTable } from "@/components/admin/ImportLogsTable";
import { createClient } from "@/lib/supabase/server";
import type { Import } from "@/types/database";
import { AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ImportAdminPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("imports").select("*").order("imported_at", { ascending: false }).limit(20);
  const imports = (data ?? []) as Import[];

  const { count: pendingCount } = await supabase
    .from("name_match_candidates")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return (
    <div>
      <TopBar title="Import / Admin" subtitle="Mettre à jour les données depuis Salesforce et les factures" />
      <main className="px-8 py-6 space-y-6">
        {!!pendingCount && (
          <Link
            href="/admin/correspondances"
            className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-5 py-4 text-sm hover:bg-warning/10"
          >
            <AlertTriangle size={18} className="text-warning" />
            <span className="text-foreground">
              <strong>{pendingCount}</strong> correspondance(s) de nom en attente de validation — des factures n&apos;ont
              pas pu être rattachées automatiquement à un compte.
            </span>
            <span className="ml-auto font-medium text-primary">Valider →</span>
          </Link>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
          <ImportForm />

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Historique des imports</CardTitle>
              <CardDescription>Traçabilité complète — aucun import n&apos;écrase silencieusement les données précédentes.</CardDescription>
            </CardHeader>
            <ImportLogsTable imports={imports} />
          </Card>
        </div>
      </main>
    </div>
  );
}
