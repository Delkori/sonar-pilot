import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { SectorObjectivesEditor } from "@/components/parametres/SectorObjectivesEditor";
import { SyncPersonasButton } from "@/components/parametres/SyncPersonasButton";
import { ImportForm } from "@/components/admin/ImportForm";
import { ImportLogsTable } from "@/components/admin/ImportLogsTable";
import { createClient } from "@/lib/supabase/server";
import { getPendingMatchCount, getSectorObjectives } from "@/lib/data/queries";
import type { Import } from "@/types/database";
import { AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default async function ParametresPage() {
  const supabase = await createClient();

  const [objectives, importsRes, pendingCount] = await Promise.all([
    getSectorObjectives(supabase),
    supabase.from("imports").select("*").order("imported_at", { ascending: false }).limit(20),
    getPendingMatchCount(supabase),
  ]);
  const imports = (importsRes.data ?? []) as Import[];

  return (
    <PageShell
      title="Paramètres"
      subtitle="Objectifs du secteur, import des données et administration"
      contentClassName="space-y-8"
    >
      <Section id="objectifs" title="Objectifs">
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
      </Section>

      <Section id="personas" title="Personas">
        <Card>
          <CardHeader>
            <CardTitle>Spécialités &amp; personas des médecins</CardTitle>
            <CardDescription>
              Récupère depuis Nexora (par RPPS) la spécialité de chaque médecin, en déduit le persona du compte
              (dermatologue / chirurgien plasticien / médecin esthétique) et le <strong>stocke en base</strong>. La
              donnée reste disponible même après une mise à jour des ventes. À relancer après un nouvel import de
              médecins.
            </CardDescription>
          </CardHeader>
          <div className="px-5 pb-5">
            <SyncPersonasButton />
          </div>
        </Card>
      </Section>

      <Section id="import" title="Import / Admin">
        {pendingCount > 0 && (
          <Link
            href="/admin/correspondances"
            className="mb-4 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-5 py-4 text-sm hover:bg-warning/10"
          >
            <AlertTriangle size={18} className="shrink-0 text-warning" />
            <span className="text-foreground">
              <strong>{pendingCount}</strong> correspondance(s) de nom en attente de validation — des factures n&apos;ont
              pas pu être rattachées automatiquement à un compte.
            </span>
            <span className="ml-auto shrink-0 font-medium text-primary">Valider →</span>
          </Link>
        )}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
          <ImportForm />
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Historique des imports</CardTitle>
              <CardDescription>
                Traçabilité complète — aucun import n&apos;écrase silencieusement les données précédentes.
              </CardDescription>
            </CardHeader>
            <ImportLogsTable imports={imports} />
          </Card>
        </div>
      </Section>
    </PageShell>
  );
}
