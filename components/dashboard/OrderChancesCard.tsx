import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { MONTHS_SHORT } from "@/lib/dates";
import { cn, formatEUR, formatPct } from "@/lib/utils";

export interface ChanceRow {
  accountId: string;
  name: string;
  probability: number;
  expectedCa: number;
  lastOrder: { year: number; month: number } | null;
  /** Le facteur qui pèse le plus, en clair. */
  factor: string;
}

/**
 * Les comptes les plus susceptibles de commander dans les trois mois,
 * d'après le modèle de probabilité (Planning › Chances) — calculé côté
 * serveur, seules les lignes de tête arrivent ici.
 */
export function OrderChancesCard({ rows, horizon }: { rows: ChanceRow[]; horizon: number }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Chances de commande — {horizon} mois</CardTitle>
          <CardDescription>Les comptes non perdus les plus probables, avec le CA attendu.</CardDescription>
        </div>
        <Link href="/planning/chances" className="shrink-0 text-xs font-medium text-primary hover:underline">
          Tous les comptes
        </Link>
      </CardHeader>
      <CardContent className="pt-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Pas encore assez d&apos;historique de ventes pour estimer des chances.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.accountId} className="flex items-center gap-3 text-sm">
                <span
                  className={cn(
                    "w-12 shrink-0 text-right font-semibold tabular-nums",
                    r.probability >= 0.6 ? "text-success" : r.probability >= 0.3 ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {formatPct(r.probability)}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/comptes/${r.accountId}`} className="block truncate text-foreground hover:text-primary">
                    {r.name}
                  </Link>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {r.factor}
                    {r.lastOrder ? ` · dernière commande ${MONTHS_SHORT[r.lastOrder.month - 1]} ${r.lastOrder.year}` : " · jamais commandé"}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground" title="CA attendu : probabilité × commande type">
                  {formatEUR(Math.round(r.expectedCa))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
