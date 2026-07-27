"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { recurrenceByAccount, RECURRENCE_BUCKETS } from "@/lib/accounts";

/**
 * Répartition du portefeuille par cadence de commande. Chaque ligne est
 * cliquable et ouvre le tableau Comptes filtré sur la cadence.
 */
export function OrderRecurrenceCard({
  monthlySales,
  accountIds,
}: {
  monthlySales: { account_id: string; year: number; month: number; ca: number }[];
  accountIds: Set<string>;
}) {
  const counts = useMemo(() => {
    const map = recurrenceByAccount(monthlySales);
    const c: Record<string, number> = { Mensuelle: 0, Bimestrielle: 0, Trimestrielle: 0, Espacée: 0, Unique: 0 };
    for (const [id, bucket] of map) {
      if (accountIds.size === 0 || accountIds.has(id)) c[bucket]++;
    }
    return c;
  }, [monthlySales, accountIds]);

  const total = Object.values(counts).reduce((s, v) => s + v, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Récurrence des commandes</CardTitle>
        <CardDescription>Cadence moyenne entre 2 commandes — cliquez pour voir les comptes</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">Importez l&apos;historique des ventes pour activer cette vue.</p>
        ) : (
          <div className="space-y-2">
            {RECURRENCE_BUCKETS.map((k) => (
              <Link key={k} href={`/comptes?recurrence=${encodeURIComponent(k)}`} className="block rounded hover:bg-surface-muted">
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">{k} →</span>
                  <span className="text-muted-foreground">{counts[k]} compte(s)</span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-muted">
                  <div className="h-1.5 rounded-full bg-indigo-400" style={{ width: `${(counts[k] / total) * 100}%` }} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
