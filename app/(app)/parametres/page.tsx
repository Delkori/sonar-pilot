import { TopBar } from "@/components/layout/TopBar";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { SectorObjectivesEditor } from "@/components/parametres/SectorObjectivesEditor";
import { createClient } from "@/lib/supabase/server";
import type { SectorObjective } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ParametresPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("sector_objectives").select("*");
  const objectives = (data ?? []) as SectorObjective[];

  return (
    <div>
      <TopBar title="Paramètres" subtitle="Objectifs et réglages du secteur" />
      <main className="px-8 py-6">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Objectifs mensuels du secteur</CardTitle>
            <CardDescription>
              Objectif de CA et de boîtes par mois pour l&apos;ensemble du secteur. Sert de référence au pilotage
              (prévu / réalisé vs objectif).
            </CardDescription>
          </CardHeader>
          <SectorObjectivesEditor initial={objectives} />
        </Card>
      </main>
    </div>
  );
}
