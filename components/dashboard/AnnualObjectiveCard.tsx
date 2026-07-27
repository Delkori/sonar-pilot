"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { formatEUR, formatPct } from "@/lib/utils";

const MONTH_LABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/**
 * Objectif annuel du secteur + courbe d'atterrissage : cumul du réalisé vs
 * cumul de l'objectif, mois par mois, pour voir si on va atteindre la cible.
 */
export function AnnualObjectiveCard({
  caByMonth,
  objectifByMonth,
  year,
}: {
  caByMonth: number[];
  objectifByMonth: number[];
  year: number;
}) {
  const annualObjectif = objectifByMonth.reduce((s, v) => s + v, 0);
  const annualRealise = caByMonth.reduce((s, v) => s + v, 0);
  const atteinte = annualObjectif > 0 ? annualRealise / annualObjectif : 0;

  if (annualObjectif === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Objectif annuel — {year}</CardTitle>
          <CardDescription>Aucun objectif défini pour {year}.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Renseignez les objectifs mensuels dans Paramètres pour activer la courbe d&apos;atterrissage.
          </p>
        </CardContent>
      </Card>
    );
  }

  // cumuls
  const cumObj: number[] = [];
  const cumReal: number[] = [];
  let ao = 0;
  let ar = 0;
  for (let i = 0; i < 12; i++) {
    ao += objectifByMonth[i] ?? 0;
    ar += caByMonth[i] ?? 0;
    cumObj.push(ao);
    cumReal.push(ar);
  }
  const max = Math.max(...cumObj, ...cumReal, 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Objectif annuel — {year}</CardTitle>
        <CardDescription>
          {formatEUR(annualRealise)} réalisés sur {formatEUR(annualObjectif)} — courbe d&apos;atterrissage cumulée
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Atteinte annuelle</span>
          <span className={`font-semibold ${atteinte >= 1 ? "text-success" : "text-foreground"}`}>{formatPct(atteinte)}</span>
        </div>
        <div className="mb-4 h-2.5 rounded-full bg-surface-muted">
          <div
            className={`h-2.5 rounded-full ${atteinte >= 1 ? "bg-success" : "bg-primary"}`}
            style={{ width: `${Math.min(atteinte, 1) * 100}%` }}
          />
        </div>
        <div className="flex items-end gap-1" style={{ height: 110 }}>
          {cumObj.map((obj, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-[85px] w-full items-end justify-center gap-0.5">
                <div
                  className="w-1/2 rounded-t bg-slate-200"
                  style={{ height: `${(obj / max) * 85}px` }}
                  title={`Objectif cumulé : ${formatEUR(obj)}`}
                />
                <div
                  className="w-1/2 rounded-t bg-primary"
                  style={{ height: `${(cumReal[i] / max) * 85}px` }}
                  title={`Réalisé cumulé : ${formatEUR(cumReal[i])}`}
                />
              </div>
              <span className="text-[9px] text-muted-foreground">{MONTH_LABELS[i]}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-200" /> Objectif cumulé</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> Réalisé cumulé</span>
        </div>
      </CardContent>
    </Card>
  );
}
