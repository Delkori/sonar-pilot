import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { PriorityAccountsTable } from "@/components/dashboard/PriorityAccountsTable";
import { createClient } from "@/lib/supabase/server";
import { formatEUR, formatNumber, formatPct } from "@/lib/utils";
import { Target, TrendingDown, Users, AlertTriangle } from "lucide-react";
import type { Account } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: accountsRaw } = await supabase.from("accounts").select("*");
  const accounts = (accountsRaw ?? []) as Account[];

  const objectifTotal = accounts.reduce((sum, a) => sum + (a.objectif_boites ?? 0), 0);
  const realiseTotal = accounts.reduce((sum, a) => sum + (a.realise_boites ?? 0), 0);
  const ecartTotal = realiseTotal - objectifTotal;
  const atteinte = objectifTotal > 0 ? realiseTotal / objectifTotal : 0;
  const caYtdTotal = accounts.reduce((sum, a) => sum + (a.ca_2026_ytd ?? 0), 0);
  const clientsActifs = accounts.filter((a) => a.status === "actif").length;
  const clientsAlerte = accounts.filter(
    (a) => a.status === "lost" || a.status === "a_risque" || (a.jours_silence ?? 0) > 90
  ).length;

  const priorityAccounts = [...accounts]
    .sort((a, b) => {
      const ecartA = (a.realise_boites ?? 0) - (a.objectif_boites ?? 0);
      const ecartB = (b.realise_boites ?? 0) - (b.objectif_boites ?? 0);
      return ecartA - ecartB;
    })
    .slice(0, 8);

  const lastImport = await supabase
    .from("imports")
    .select("imported_at, filename")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div>
      <TopBar
        title="Dashboard — Secteur Auvergne-Rhône-Alpes"
        subtitle={
          lastImport.data
            ? `Dernière mise à jour : ${new Date(lastImport.data.imported_at).toLocaleString("fr-FR")} (${lastImport.data.filename})`
            : "Aucun import réalisé pour le moment — rendez-vous dans Import"
        }
      />

      <main className="px-8 py-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Objectif Q3 (boîtes)" value={formatNumber(objectifTotal)} icon={Target} />
          <KpiCard
            label="Réalisé (boîtes)"
            value={formatNumber(realiseTotal)}
            trend={`${formatPct(atteinte)} de l'objectif`}
            tone={atteinte >= 1 ? "positive" : "default"}
            icon={TrendingDown}
          />
          <KpiCard
            label="Écart"
            value={`${ecartTotal > 0 ? "+" : ""}${formatNumber(ecartTotal)}`}
            tone={ecartTotal < 0 ? "negative" : "positive"}
            icon={AlertTriangle}
          />
          <KpiCard label="CA 2026 YTD" value={formatEUR(caYtdTotal)} icon={Users} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Vue management</CardTitle>
              <CardDescription>Synthèse du portefeuille</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Comptes suivis</span>
                <span className="font-medium">{formatNumber(accounts.length)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Clients actifs</span>
                <span className="font-medium">{formatNumber(clientsActifs)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Alertes commerciales</span>
                <span className="font-medium text-danger">{formatNumber(clientsAlerte)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-3">
                <span className="text-muted-foreground">Segment A</span>
                <span className="font-medium">{accounts.filter((a) => a.segment === "A").length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Segment B</span>
                <span className="font-medium">{accounts.filter((a) => a.segment === "B").length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Segment C</span>
                <span className="font-medium">{accounts.filter((a) => a.segment === "C").length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Segment D</span>
                <span className="font-medium">{accounts.filter((a) => a.segment === "D").length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Segment E</span>
                <span className="font-medium">{accounts.filter((a) => a.segment === "E").length}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Comptes prioritaires</CardTitle>
              <CardDescription>Écart le plus critique entre objectif et réalisé</CardDescription>
            </CardHeader>
            <PriorityAccountsTable accounts={priorityAccounts} />
          </Card>
        </div>
      </main>
    </div>
  );
}
