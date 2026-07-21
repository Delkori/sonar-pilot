import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { NexoraDoctorsTable } from "@/components/sponsoring/NexoraDoctorsTable";
import type { NexoraDoctor } from "@/components/sponsoring/NexoraDoctorsTable";
import { createClient } from "@/lib/supabase/server";
import { formatEUR } from "@/lib/utils";
import type { HcpSponsorship, Hcp } from "@/types/database";

export const dynamic = "force-dynamic";

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

export default async function SponsoringPage() {
  const supabase = await createClient();

  const { data: sponsorRaw } = await supabase.from("hcp_sponsorships").select("*").eq("source", "nexora");
  const rows = (sponsorRaw ?? []) as HcpSponsorship[];

  const { data: hcpsRaw } = await supabase.from("hcps").select("rpps, name");
  const hcps = (hcpsRaw ?? []) as Pick<Hcp, "rpps" | "name">[];
  const hcpRpps = new Set(hcps.map((h) => h.rpps).filter(Boolean) as string[]);
  const hcpNames = new Set(hcps.map((h) => norm(h.name)));

  // ── Montants par laboratoire concurrent (indicateur)
  const parLabo = new Map<string, { montant: number; medecins: Set<string> }>();
  for (const r of rows) {
    if (!r.laboratoire) continue;
    const key = r.laboratoire;
    const cur = parLabo.get(key) ?? { montant: 0, medecins: new Set<string>() };
    cur.montant += r.montant ?? 0;
    cur.medecins.add(r.rpps ?? r.hcp_name ?? r.id);
    parLabo.set(key, cur);
  }
  const labos = Array.from(parLabo.entries())
    .map(([laboratoire, v]) => ({ laboratoire, montant: v.montant, medecins: v.medecins.size }))
    .sort((a, b) => b.montant - a.montant);
  const totalConcurrents = labos.reduce((s, l) => s + l.montant, 0);

  // ── Médecins Nexora (dédupliqués), avec statut présence Salesforce
  const byDoctor = new Map<string, NexoraDoctor>();
  for (const r of rows) {
    const name = r.hcp_name ?? "Médecin inconnu";
    const key = r.rpps ?? norm(name);
    const dansSalesforce = (r.rpps ? hcpRpps.has(r.rpps) : false) || hcpNames.has(norm(name));
    const existing = byDoctor.get(key);
    if (existing) {
      if (r.laboratoire && !existing.labos.includes(r.laboratoire)) existing.labos.push(r.laboratoire);
      // le montant "agrégé" (ligne sans labo) prime, sinon on garde le max
      existing.montant = Math.max(existing.montant ?? 0, r.montant ?? 0);
    } else {
      byDoctor.set(key, {
        key,
        medecin: name,
        specialite: r.specialite,
        structure: r.structure_nom,
        departement: r.departement,
        labos: r.laboratoire ? [r.laboratoire] : [],
        montant: r.montant,
        dansSalesforce,
      });
    }
  }
  const doctors = Array.from(byDoctor.values());
  const absents = doctors.filter((d) => !d.dansSalesforce).length;

  return (
    <div>
      <TopBar
        title="Sponsoring & concurrence"
        subtitle="Données Nexora : quels laboratoires concurrents sponsorisent quels médecins, et pour quels montants"
      />
      <main className="space-y-6 px-8 py-6">
        {rows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Aucune donnée de sponsoring. Allez sur la page Import et cliquez « Synchroniser le sponsoring Nexora ».
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Investissement des laboratoires concurrents</CardTitle>
                <CardDescription>
                  Montant total sponsorisé par labo (source Nexora) — {formatEUR(totalConcurrents)} au total
                </CardDescription>
              </CardHeader>
              <CardContent>
                {labos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun montant par laboratoire pour l&apos;instant.</p>
                ) : (
                  <div className="space-y-3">
                    {labos.map((l) => {
                      const max = Math.max(...labos.map((x) => x.montant), 1);
                      return (
                        <div key={l.laboratoire}>
                          <div className="mb-1 flex items-center justify-between text-sm">
                            <span className="font-medium text-foreground">{l.laboratoire}</span>
                            <span className="text-muted-foreground">
                              {formatEUR(l.montant)} · {l.medecins} médecin(s)
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-surface-muted">
                            <div className="h-2 rounded-full bg-amber-400" style={{ width: `${(l.montant / max) * 100}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Médecins connus dans Nexora</CardTitle>
                <CardDescription>
                  {doctors.length} médecin(s) — dont {absents} absent(s) de votre Salesforce (à prospecter éventuellement)
                </CardDescription>
              </CardHeader>
              <NexoraDoctorsTable doctors={doctors} />
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
