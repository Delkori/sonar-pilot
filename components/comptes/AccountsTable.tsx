"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SegmentBadge, StatusBadge } from "@/components/ui/Badge";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { Account, AccountStatus, Segment } from "@/types/database";

export function AccountsTable({ accounts }: { accounts: Account[] }) {
  const [segment, setSegment] = useState<Segment | "all">("all");
  const [status, setStatus] = useState<AccountStatus | "all">("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return accounts.filter((a) => {
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
  }, [accounts, segment, status, search]);

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
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} compte(s)</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 font-medium">Compte</th>
              <th className="px-3 py-3 font-medium">Seg</th>
              <th className="px-3 py-3 font-medium">Statut</th>
              <th className="px-3 py-3 font-medium">Ville</th>
              <th className="px-3 py-3 font-medium">CP</th>
              <th className="px-3 py-3 font-medium text-right">Potentiel</th>
              <th className="px-3 py-3 font-medium text-right">CA 2026 YTD</th>
              <th className="px-5 py-3 font-medium">Prochaine action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0 hover:bg-surface-muted">
                <td className="px-5 py-3">
                  <Link href={`/comptes/${a.id}`} className="font-medium text-foreground hover:text-primary">
                    {a.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{a.external_ref}</p>
                </td>
                <td className="px-3 py-3"><SegmentBadge segment={a.segment} /></td>
                <td className="px-3 py-3"><StatusBadge status={a.status} /></td>
                <td className="px-3 py-3 text-muted-foreground">{a.city ?? "—"}</td>
                <td className="px-3 py-3 text-muted-foreground">{a.postal_code ?? "—"}</td>
                <td className="px-3 py-3 text-right text-muted-foreground">{formatNumber(a.potentiel_boites)}</td>
                <td className="px-3 py-3 text-right text-foreground">{formatEUR(a.ca_2026_ytd)}</td>
                <td className="px-5 py-3 text-muted-foreground max-w-64 truncate">{a.action_recommandee ?? "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
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
