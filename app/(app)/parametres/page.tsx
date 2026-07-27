import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { SectorObjectivesEditor } from "@/components/parametres/SectorObjectivesEditor";
import { SyncPersonasButton } from "@/components/parametres/SyncPersonasButton";
import { ImportForm } from "@/components/admin/ImportForm";
import { ImportLogsTable } from "@/components/admin/ImportLogsTable";
import { createClient } from "@/lib/supabase/server";
import type { SectorObjective, Import } from "@/types/database";
import { AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ParametresPage() {
  const supabase = await createClient();
  const { data: objRaw } = await supabase.from("sector_objectives").select("*");
  const objectives = (objRaw ?? []) as SectorObjective[];

  const { data: importsRaw } = await supabase
    .from("imports")
    .select("*")
    .order("imported_at", { ascending: false })
    .limit(20);
  const imports = (importsRaw ?? []) as Import[];

  const { count: pendingCount } = await supabase
    .from("name_match_candidates")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return (
    <div>
      <TopBar title="Paramètres" subtitle="Objectifs du secteur, import des données et administration" />
      <main className="space-y-8 px-8 py-6">
        {/* ── Objectifs ─────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Objectifs</h2>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Objectifs mensuels du secteur</CardTitle>
              <CardDescription>
                Objectif de CA et de boîtes par mois. Sert de référence dans les dashboards (Objectif vs Réalisé) et au
                pilotage.
              </CardDescription>
            </CardHeader>
            <SectorObjectivesEditor initial={objectives} />
          </Card>
        </section>

        {/* ── Personas ──────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Personas</h2>
          <Card>
            <CardHeader>
              <CardTitle>Spécialités & personas des médecins</CardTitle>
              <CardDescription>
                Récupère depuis Nexora (par RPPS) la spécialité de chaque médecin, en déduit le persona du compte
                (dermatologue / chirurgien plasticien / médecin esthétique) et le <strong>stocke en base</strong>. La
                donnée reste disponible même après une mise à jour des ventes. À relancer après un nouvel import de
                médecins.
              </CardDescription>
            </CardHeader>
            <div className="px-6 pb-6">
              <SyncPersonasButton />
            </div>
          </Card>
        </section>

        {/* ── Import / Admin ────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Import / Admin</h2>
          {!!pendingCount && (
            <Link
              href="/admin/correspondances"
              className="mb-4 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-5 py-4 text-sm hover:bg-warning/10"
            >
              <AlertTriangle size={18} className="text-warning" />
              <span className="text-foreground">
                <strong>{pendingCount}</strong> correspondance(s) de nom en attente de validation.
              </span>
              <span className="ml-auto font-medium text-primary">Valider →</span>
            </Link>
          )}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
            <ImportForm />
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Historique des imports</CardTitle>
                <CardDescription>Traçabilité complète — aucun import n&apos;écrase silencieusement les données.</CardDescription>
              </CardHeader>
              <ImportLogsTable imports={imports} />
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}
