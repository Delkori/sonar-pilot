import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { formatEUR } from "@/lib/utils";

interface Sale {
  year: number;
  month: number;
  ca: number;
}

const MONTH_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

/**
 * Historique de commandes + récurrence, à partir des ventes mensuelles
 * réelles (account_monthly_sales, issu des factures). Répond au besoin de
 * "voir les commandes et leur récurrence dans la fiche".
 */
export function OrderHistoryCard({ sales }: { sales: Sale[] }) {
  if (sales.length === 0) return null;

  const sorted = [...sales].sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  const active = sorted.filter((s) => s.ca > 0);

  // récurrence = écart moyen (en mois) entre deux mois de commande
  let avgGap: number | null = null;
  if (active.length >= 2) {
    let totalGap = 0;
    for (let i = 1; i < active.length; i++) {
      totalGap += active[i].year * 12 + active[i].month - (active[i - 1].year * 12 + active[i - 1].month);
    }
    avgGap = totalGap / (active.length - 1);
  }

  const last = active[active.length - 1];
  const totalCa = active.reduce((s, v) => s + v.ca, 0);
  const last12 = sorted.slice(-12);
  const max = Math.max(...last12.map((s) => s.ca), 1);

  const recurrenceLabel =
    avgGap === null
      ? "Commande unique"
      : avgGap <= 1.3
      ? "Mensuelle"
      : avgGap <= 2.5
      ? "~Bimestrielle"
      : avgGap <= 4
      ? "~Trimestrielle"
      : `~Tous les ${Math.round(avgGap)} mois`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historique de commandes</CardTitle>
        <CardDescription>Ventes mensuelles réelles issues des factures importées</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg border border-border p-2">
            <p className="text-xs text-muted-foreground">Récurrence</p>
            <p className="text-sm font-semibold text-foreground">{recurrenceLabel}</p>
          </div>
          <div className="rounded-lg border border-border p-2">
            <p className="text-xs text-muted-foreground">Mois commandés</p>
            <p className="text-sm font-semibold text-foreground">{active.length}</p>
          </div>
          <div className="rounded-lg border border-border p-2">
            <p className="text-xs text-muted-foreground">Dernière</p>
            <p className="text-sm font-semibold text-foreground">
              {last ? `${MONTH_LABELS[last.month - 1]} ${last.year}` : "—"}
            </p>
          </div>
        </div>

        <div className="flex items-end gap-1" style={{ height: 90 }}>
          {last12.map((s) => (
            <div key={`${s.year}-${s.month}`} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={`w-full rounded-t ${s.ca > 0 ? "bg-primary-100" : "bg-surface-muted"}`}
                style={{ height: `${Math.max((s.ca / max) * 70, s.ca > 0 ? 4 : 2)}px` }}
                title={`${MONTH_LABELS[s.month - 1]} ${s.year} : ${formatEUR(s.ca)}`}
              />
              <span className="text-[9px] text-muted-foreground">{MONTH_LABELS[s.month - 1]}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-right text-xs text-muted-foreground">
          Total sur la période : {formatEUR(totalCa)}
        </p>
      </CardContent>
    </Card>
  );
}
