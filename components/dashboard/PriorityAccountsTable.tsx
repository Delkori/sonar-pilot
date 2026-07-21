"use client";

import Link from "next/link";
import { SegmentBadge, StatusBadge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR } from "@/lib/utils";
import { ACTION_META, computeTargetingScore } from "@/lib/scoring";
import type { Account } from "@/types/database";

type Row = { account: Account; score: ReturnType<typeof computeTargetingScore> };
type SortKey = "name" | "segment" | "status" | "score" | "ca_non_capte";

export function PriorityAccountsTable({ accounts }: { accounts: Account[] }) {
  const rows: Row[] = accounts.map((a) => ({ account: a, score: computeTargetingScore(a) }));

  const { sorted, sortKey, dir, toggle } = useSortableTable<Row, SortKey>(
    rows,
    {
      name: (r) => r.account.name,
      segment: (r) => r.account.segment,
      status: (r) => r.account.status,
      score: (r) => r.score.total,
      ca_non_capte: (r) => r.score.caNonCapte,
    },
    "score"
  );

  if (accounts.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucun compte importé pour le moment.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
          <SortableTh label="Compte" sortKey="name" activeKey={sortKey} dir={dir} onSort={toggle} className="px-5" />
          <SortableTh label="Seg" sortKey="segment" activeKey={sortKey} dir={dir} onSort={toggle} />
          <SortableTh label="Statut" sortKey="status" activeKey={sortKey} dir={dir} onSort={toggle} />
          <SortableTh label="Score" sortKey="score" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
          <SortableTh label="CA non capté" sortKey="ca_non_capte" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
          <th className="px-5 py-3 font-medium">Action recommandée</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(({ account: a, score }) => {
          const meta = ACTION_META[score.action];
          return (
            <tr key={a.id} className="border-b border-border last:border-0 hover:bg-surface-muted">
              <td className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <Link href={`/comptes/${a.id}`} className="font-medium text-foreground hover:text-primary">
                    {a.name}
                  </Link>
                  <ScoreBadge score={score.total} />
                </div>
                <p className="text-xs text-muted-foreground">{a.city ?? "Ville inconnue"}</p>
              </td>
              <td className="px-3 py-3"><SegmentBadge segment={a.segment} /></td>
              <td className="px-3 py-3"><StatusBadge status={a.status} /></td>
              <td className="px-3 py-3 text-right font-medium text-foreground">{score.total}/100</td>
              <td className="px-3 py-3 text-right text-muted-foreground">{formatEUR(score.caNonCapte)}</td>
              <td className="px-5 py-3">
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                  style={{ backgroundColor: meta.color }}
                >
                  {meta.label}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
