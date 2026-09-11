"use client";

import { theadRowClass } from "@/components/ui/Table";
import { fieldClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { SegmentBadge, StatusBadge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR, formatNumber } from "@/lib/utils";
import { ACTION_META, computeTargetingScore } from "@/lib/scoring";
import { RECURRENCE_BUCKETS } from "@/lib/accounts";
import type { RecurrenceBucket } from "@/lib/accounts";
import { referenceYears, revenueByAccountYear, revenueForYear } from "@/lib/revenue";
import type { YearlySaleRow } from "@/lib/revenue";
import type { Account, AccountStatus, Segment } from "@/types/database";

type ScoredAccount = { account: Account; score: ReturnType<typeof computeTargetingScore> };
type SortKey =
  | "name"
  | "segment"
  | "status"
  | "city"
  | "tier"
  | "recurrence"
  | "ca_n1"
  | "ca_ytd"
  | "potentiel"
  | "score"
  | "ca_non_capte";

const TIER_ORDER: Record<string, number> = { "Pro+": 3, Pro: 2, Premium: 1 };
const RECU_ORDER: Record<string, number> = { Mensuelle: 5, Bimestrielle: 4, Trimestrielle: 3, Espacée: 2, Unique: 1 };

export function AccountsTable({
  accounts,
  recurrence = {},
  monthlySales = [],
  initialTier = "all",
  initialRecurrence = "all",
}: {
  accounts: Account[];
  recurrence?: Record<string, RecurrenceBucket>;
  /** Ventes mensuelles réelles — source du CA par exercice (lib/revenue.ts). */
  monthlySales?: YearlySaleRow[];
  initialTier?: string;
  initialRecurrence?: string;
}) {
  // Les colonnes CA suivent l'exercice : « CA 2025 » / « CA 2026 YTD » en dur
  // auraient affiché des exercices clos indéfiniment.
  const anneeEnCours = new Date().getFullYear();
  const { derniereAnnee } = referenceYears();
  const caParAnnee = useMemo(() => revenueByAccountYear(monthlySales), [monthlySales]);
  const caPourAnnee = useCallback(
    (account: Account, annee: number) => revenueForYear(account, annee, caParAnnee),
    [caParAnnee]
  );
  const [segment, setSegment] = useState<Segment | "all">("all");
  const [status, setStatus] = useState<AccountStatus | "all">("all");
  const [tier, setTier] = useState<string>(initialTier);
  const [recu, setRecu] = useState<string>(initialRecurrence);
  const [search, setSearch] = useState("");

  const scored = useMemo(
    () => accounts.map((a) => ({ account: a, score: computeTargetingScore(a, { caByAccountYear: caParAnnee }) })),
    [accounts, caParAnnee]
  );

  const filtered = useMemo(() => {
    return scored.filter(({ account: a }) => {
      if (segment !== "all" && a.segment !== segment) return false;
      if (status !== "all" && a.status !== status) return false;
      if (tier !== "all" && a.price_list !== tier) return false;
      if (recu !== "all" && recurrence[a.id] !== recu) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!a.name.toLowerCase().includes(q) && !(a.city ?? "").toLowerCase().includes(q) && !(a.postal_code ?? "").includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [scored, segment, status, tier, recu, search, recurrence]);

  const { sorted, sortKey, dir, toggle } = useSortableTable<ScoredAccount, SortKey>(
    filtered,
    {
      name: (r) => r.account.name,
      segment: (r) => r.account.segment,
      status: (r) => r.account.status,
      city: (r) => r.account.city,
      tier: (r) => (r.account.price_list ? TIER_ORDER[r.account.price_list] ?? 0 : null),
      recurrence: (r) => RECU_ORDER[recurrence[r.account.id]] ?? null,
      ca_n1: (r) => caPourAnnee(r.account, derniereAnnee),
      ca_ytd: (r) => caPourAnnee(r.account, anneeEnCours),
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
          className={cn(fieldClass, "min-w-64")}
        />
        <select
          value={segment}
          onChange={(e) => setSegment(e.target.value as Segment | "all")}
          className={fieldClass}
        >
          <option value="all">Tous segments</option>
          {(["A", "B", "C", "D", "E"] as const).map((s) => (
            <option key={s} value={s}>Segment {s}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as AccountStatus | "all")}
          className={fieldClass}
        >
          <option value="all">Tous statuts</option>
          <option value="actif">Actif</option>
          <option value="lost">Lost</option>
          <option value="new">Nouveau</option>
          <option value="reconnected">Reconnecté</option>
          <option value="a_risque">À risque</option>
          <option value="a_suivre">À suivre</option>
        </select>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className={fieldClass}
        >
          <option value="all">Tous contrats</option>
          <option value="Premium">Premium</option>
          <option value="Pro">Pro</option>
          <option value="Pro+">Pro+</option>
        </select>
        <select
          value={recu}
          onChange={(e) => setRecu(e.target.value)}
          className={fieldClass}
        >
          <option value="all">Toute récurrence</option>
          {RECURRENCE_BUCKETS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{sorted.length} compte(s)</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={theadRowClass}>
              <SortableTh label="Compte" sortKey="name" activeKey={sortKey} dir={dir} onSort={toggle} className="px-5" />
              <SortableTh label="Seg" sortKey="segment" activeKey={sortKey} dir={dir} onSort={toggle} />
              <SortableTh label="Statut" sortKey="status" activeKey={sortKey} dir={dir} onSort={toggle} />
              <SortableTh label="Ville" sortKey="city" activeKey={sortKey} dir={dir} onSort={toggle} />
              <SortableTh label="Contrat" sortKey="tier" activeKey={sortKey} dir={dir} onSort={toggle} />
              <SortableTh label="Récurrence" sortKey="recurrence" activeKey={sortKey} dir={dir} onSort={toggle} />
              <SortableTh label={`CA ${derniereAnnee}`} sortKey="ca_n1" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
              <SortableTh label={`CA ${anneeEnCours} YTD`} sortKey="ca_ytd" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
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
                  <td className="px-3 py-3">
                    {recurrence[a.id] ? (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{recurrence[a.id]}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{formatEUR(caPourAnnee(a, derniereAnnee))}</td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{formatEUR(caPourAnnee(a, anneeEnCours))}</td>
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
                <td colSpan={12} className="px-5 py-10 text-center text-muted-foreground">
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
