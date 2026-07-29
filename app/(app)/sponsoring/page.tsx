import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { ProspectsTable } from "@/components/sponsoring/ProspectsTable";
import type { ProspectRow } from "@/components/sponsoring/ProspectsTable";
import { createClient } from "@/lib/supabase/server";
import { formatEUR } from "@/lib/utils";
import {
  nexoraConfigured,
  getCompetitorAmounts,
  getProspects,
  SECTEUR_DEPTS,
  SECTEUR_REGION,
} from "@/lib/nexora/queries";
import type { Hcp } from "@/types/database";

export const dynamic = "force-dynamic";

const CONCURRENT_LABS = new Set(["Teoxane"]); // pour distinguer votre labo des concurrents

export default async function SponsoringPage() {
  if (!nexoraConfigured()) {
    return (
      <div>
        <TopBar title="Sponsoring & concurrence" subtitle="Base Transparence Santé (Nexora)" />
        <main className="px-8 py-6">
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Connexion Nexora non configurée. Ajoutez <code>NEXORA_SUPABASE_URL</code> et{" "}
              <code>NEXORA_SUPABASE_ANON_KEY</code> (ou service role) dans les variables d&apos;environnement Vercel.
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: hcpsRaw } = await supabase.from("hcps").select("rpps");
  const hcpRpps = new Set(((hcpsRaw ?? []) as Pick<Hcp, "rpps">[]).map((h) => h.rpps).filter(Boolean) as string[]);

  const [amounts, prospectsRaw] = await Promise.all([
    getCompetitorAmounts(SECTEUR_REGION),
    getProspects({ depts: SECTEUR_DEPTS, onlySponso: true, onlyEsth: true, limit: 500 }),
  ]);

  const totalConcurrents = amounts.filter((a) => !CONCURRENT_LABS.has(a.nom_labo)).reduce((s, a) => s + a.montant, 0);
  const maxMontant = Math.max(...amounts.map((a) => a.montant), 1);

  const prospects: ProspectRow[] = prospectsRaw.map((p) => ({
    rpps: p.rpps,
    medecin: `${p.prenom ? p.prenom + " " : ""}${p.nom}`,
    specialite: p.specialite,
    ville: p.ville,
    dept: p.dept,
    montant: p.montant_percu,
    dansSalesforce: hcpRpps.has(p.rpps),
  }));
  const absents = prospects.filter((p) => !p.dansSalesforce).length;

  return (
    <div>
      <TopBar
        title="Sponsoring & concurrence"
        subtitle="Base Transparence Santé — médecins sponsorisés et investissement des laboratoires sur votre secteur"
      />
      <main className="space-y-6 px-8 py-6">
        {amounts.length === 0 && prospects.length === 0 && (
          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">
              Connexion Nexora configurée, mais aucune donnée renvoyée pour {SECTEUR_REGION} — soit la base
              Transparence Santé n&apos;a rien à déclarer sur ce secteur, soit les fonctions <code>sonar_*</code>{" "}
              ont changé côté Nexora. Voir les logs serveur Vercel (recherche &quot;[nexora]&quot;) pour le détail.
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Investissement des laboratoires — {SECTEUR_REGION}</CardTitle>
            <CardDescription>
              Montant total sponsorisé par labo sur le secteur (avantages + rémunérations + conventions). Concurrents :{" "}
              {formatEUR(totalConcurrents)}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {amounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune donnée.</p>
            ) : (
              <div className="space-y-3">
                {amounts.slice(0, 15).map((l) => {
                  const isVous = CONCURRENT_LABS.has(l.nom_labo);
                  return (
                    <div key={l.nom_labo}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className={`font-medium ${isVous ? "text-primary" : "text-foreground"}`}>
                          {l.nom_labo} {isVous && <span className="text-xs">(vous)</span>}
                        </span>
                        <span className="text-muted-foreground">
                          {formatEUR(l.montant)} · {l.nb_medecins} médecin(s)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-muted">
                        <div
                          className={`h-2 rounded-full ${isVous ? "bg-primary" : "bg-amber-400"}`}
                          style={{ width: `${(l.montant / maxMontant) * 100}%` }}
                        />
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
            <CardTitle>Médecins sponsorisés du secteur (Transparence Santé)</CardTitle>
            <CardDescription>
              {prospects.length} médecins esthétique/dermato/chirurgie sponsorisés dans vos départements — dont {absents}{" "}
              absent(s) de votre Salesforce (prospects potentiels). Classés par montant perçu.
            </CardDescription>
          </CardHeader>
          <ProspectsTable rows={prospects} />
        </Card>
      </main>
    </div>
  );
}
