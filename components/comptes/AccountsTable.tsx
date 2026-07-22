"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SegmentBadge, StatusBadge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR, formatNumber } from "@/lib/utils";
import { ACTION_META, computeTargetingScore } from "@/lib/scoring";
import type { Account, AccountStatus, Segment } from "@/types/database";

type ScoredAccount = { account: Account; score: ReturnType<typeof computeTargetingScore> };
type SortKey =
  | "name"
  | "segment"
  | "status"
  | "city"
  | "tier"
  | "ca_2025"
  | "ca_ytd"
  | "potentiel"
  | "score"
  | "ca_non_capte";

const TIER_ORDER: Record<string, number> = { "Pro+": 3, Pro: 2, Premium: 1 };

export function AccountsTable({ accounts }: { accounts: Account[] }) {
  const [segment, setSegment] = useState<Segment | "all">("all");
  const [status, setStatus] = useState<AccountStatus | "all">("all");
  const [search, setSearch] = useState("");

  const scored = useMemo(() => accounts.map((a) => ({ account: a, score: computeTargetingScore(a) })), [accounts]);

  const filtered = useMemo(() => {
    return scored.filter(({ account: a }) => {
      if (segment !== "all" && a.segment !== segment) return false;
      if (status !== "all" && a.status !== status) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!a.name.toLowerCase().includes(q) && !(a.city ?? "").toLowerCase().includes(q) && !(a.postal_code ?? "").includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [scored, segment, status, search]);

  const { sorted, sortKey, dir, toggle } = useSortableTable<ScoredAccount, SortKey>(
    filtered,
    {
      name: (r) => r.account.name,
      segment: (r) => r.account.segment,
      status: (r) => r.account.status,
      city: (r) => r.account.city,
      tier: (r) => (r.account.price_list ? TIER_ORDER[r.account.price_list] ?? 0 : null),
      ca_2025: (r) => r.account.ca_2025,
      ca_ytd: (r) => r.account.ca_2026_ytd,
      potentiel: (r) => r.account.potentiel_boites,
      score: (r) => r.score.total,
      ca_non_capte: (r) => r.score.caNonCapte,
    },
    "score"
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-muted px-5 py-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un compte, une ville, un CP..."
          className="min-w-64 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
        <select
          value={segment}
          onChange={(e) => setSegment(e.target.value as Segment | "all")}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        >
          <option value="all">Tous segments</option>
          {(["A", "B", "C", "D", "E"] as const).map((s) => (
            <option key={s} value={s}>Segment {s}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as AccountStatus | "all")}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        >
          <option value="all">Tous statuts</option>
          <option value="actif">Actif</option>
          <option value="lost">Lost</option>
          <option value="new">Nouveau</option>
          <option value="reconnected">Reconnecté</option>
          <option value="a_risque">À risque</option>
          <option value="a_suivre">À suivre</option>
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{sorted.length} compte(s)</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <SortableTh label="Compte" sortKey="name" activeKey={sortKey} dir={dir} onSort={toggle} className="px-5" />
              <SortableTh label="Seg" sortKey="segment" activeKey={sortKey} dir={dir} onSort={toggle} />
              <SortableTh label="Statut" sortKey="status" activeKey={sortKey} dir={dir} onSort={toggle} />
              <SortableTh label="Ville" sortKey="city" activeKey={sortKey} dir={dir} onSort={toggle} />
              <SortableTh label="Contrat" sortKey="tier" activeKey={sortKey} dir={dir} onSort={toggle} />
              <SortableTh label="CA 2025" sortKey="ca_2025" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
              <SortableTh label="CA 2026 YTD" sortKey="ca_ytd" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
              <SortableTh label="Potentiel" sortKey="potentiel" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
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
                    <p className="text-xs text-muted-foreground">{a.external_ref}</p>
                  </td>
                  <td className="px-3 py-3"><SegmentBadge segment={a.segment} /></td>
                  <td className="px-3 py-3"><StatusBadge status={a.status} /></td>
                  <td className="px-3 py-3 text-muted-foreground">{a.city ?? "—"}</td>
                  <td className="px-3 py-3">
                    {a.price_list && TIER_ORDER[a.price_list] ? (
                      <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">{a.price_list}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{formatEUR(a.ca_2025 ?? 0)}</td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{formatEUR(a.ca_2026_ytd ?? 0)}</td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{formatNumber(a.potentiel_boites ?? 0)}</td>
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
            {sorted.length === 0 && (
              <tr>
                <td colSpan={11} className="px-5 py-10 text-center text-muted-foreground">
                  Aucun compte ne correspond à ces filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
