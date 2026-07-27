"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { formatEUR, formatPct } from "@/lib/utils";
import type { CompetitorAmount } from "@/lib/nexora/queries";

const MON_LABO = "Teoxane";

/**
 * Part de voix sponsoring : Teoxane vs concurrents sur le secteur, depuis la
 * base Transparence Santé (Nexora).
 */
export function CompetitorShareCard({ amounts }: { amounts: CompetitorAmount[] }) {
  const total = amounts.reduce((s, a) => s + a.montant, 0);
  const teoxane = amounts.find((a) => a.nom_labo === MON_LABO)?.montant ?? 0;
  const part = total > 0 ? teoxane / total : 0;
  const max = Math.max(...amounts.map((a) => a.montant), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sponsoring : Teoxane vs concurrents</CardTitle>
        <CardDescription>Part de voix sur le secteur (base Transparence Santé)</CardDescription>
      </CardHeader>
      <CardContent>
        {amounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Données indisponibles — vérifiez la connexion Nexora (variables d&apos;environnement).
          </p>
        ) : (
          <>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Part de voix Teoxane</span>
              <span className="font-semibold text-primary">{formatPct(part)}</span>
            </div>
            <div className="mb-4 h-2.5 rounded-full bg-surface-muted">
              <div className="h-2.5 rounded-full bg-primary" style={{ width: `${part * 100}%` }} />
            </div>
            <div className="space-y-2">
              {amounts.slice(0, 8).map((l) => {
                const isVous = l.nom_labo === MON_LABO;
                return (
                  <div key={l.nom_labo}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className={`font-medium ${isVous ? "text-primary" : "text-foreground"}`}>
                        {l.nom_labo} {isVous && <span className="text-[10px]">(vous)</span>}
                      </span>
                      <span className="text-muted-foreground">{formatEUR(l.montant)} · {l.nb_medecins} méd.</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-muted">
                      <div className={`h-1.5 rounded-full ${isVous ? "bg-primary" : "bg-amber-400"}`} style={{ width: `${(l.montant / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
