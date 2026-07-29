"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { formatEUR, formatPct } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { Account } from "@/types/database";

interface Row {
  account: Account;
  ca2026: number;
  ca2025: number;
  evolution: number | null;
}

export function TopFlopClientsCard({ title, rows, tone }: { title: string; rows: Row[]; tone: "positive" | "negative" }) {
  const Icon = tone === "positive" ? TrendingUp : TrendingDown;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>CA 2026 (YTD) vs CA 2025</CardDescription>
        </div>
        <Icon size={18} className={tone === "positive" ? "text-success" : "text-danger"} />
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Pas assez de données (nécessite CA 2025).</p>}
        {rows.map(({ account: a, ca2026, ca2025, evolution }, idx) => (
          <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-4 shrink-0 text-xs text-muted-foreground">{idx + 1}.</span>
              <Link href={`/comptes/${a.id}`} className="truncate text-foreground hover:text-primary">
                {a.name}
              </Link>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs">
              <span className="text-muted-foreground">{formatEUR(ca2025)} → </span>
              <span className="font-medium text-foreground">{formatEUR(ca2026)}</span>
              {evolution !== null && (
                <span className={tone === "positive" ? "text-success" : "text-danger"}>
                  ({evolution > 0 ? "+" : ""}
                  {formatPct(evolution)})
                </span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
