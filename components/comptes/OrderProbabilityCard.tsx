import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { cn, formatEUR, formatPct } from "@/lib/utils";
import type { AccountProbability, ProbabilityModel } from "@/lib/probability";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

/**
 * Probabilité de commande d'un compte, avec ses facteurs — rendu serveur,
 * sans état : le modèle est entraîné dans la page (voir lib/probability.ts).
 */
export function OrderProbabilityCard({ result, model }: { result: AccountProbability; model: ProbabilityModel }) {
  const pct = Math.round(result.probability * 100);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Probabilité de commande — {model.horizon} mois</CardTitle>
        <CardDescription>
          Apprise sur l&apos;historique du portefeuille ; taux de base {formatPct(model.baseRate)}.{" "}
          <Link href="/analyse" className="text-primary hover:underline">
            Voir tous les comptes
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-end gap-3">
          <span className="text-4xl font-semibold tabular-nums text-foreground">{pct} %</span>
          <span className="pb-1 text-xs text-muted-foreground">
            {result.expectedCa > 0 ? `≈ ${formatEUR(Math.round(result.expectedCa))} attendus` : "pas de commande type connue"}
          </span>
        </div>
        <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          <div
            className="absolute inset-y-0 w-px bg-foreground/40"
            style={{ left: `${Math.round(model.baseRate * 100)}%` }}
            title={`Taux de base : ${formatPct(model.baseRate)}`}
            aria-hidden
          />
        </div>

        <ul className="mt-4 space-y-1.5">
          {result.factors.map((f) => {
            const favorable = f.weight > 0;
            const neutre = Math.abs(f.weight) < 0.05;
            const Icon = favorable ? ArrowUpRight : ArrowDownRight;
            return (
              <li key={f.key} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon
                    size={12}
                    className={cn("shrink-0", neutre ? "text-muted-foreground/50" : favorable ? "text-success" : "text-warning")}
                  />
                  <span className="truncate text-muted-foreground">{f.label} :</span>
                  <span className="truncate text-foreground">{f.levelLabel}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground" title="Taux de commande observé sur les comptes dans ce cas">
                  {formatPct(f.rate)}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
