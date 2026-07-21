"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SegmentBadge, StatusBadge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { nextWeekdays } from "@/lib/followups";
import type { PhoneFollowUp } from "@/lib/followups";
import { formatNumber } from "@/lib/utils";
import { Phone, CheckCircle2, Loader2 } from "lucide-react";

type SortKey = "name" | "segment" | "status" | "score" | "silence";

export function RelancesTable({ followUps }: { followUps: PhoneFollowUp[] }) {
  const [planned, setPlanned] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const weekdays = nextWeekdays(5);

  const { sorted, sortKey, dir, toggle } = useSortableTable<PhoneFollowUp, SortKey>(
    followUps,
    {
      name: (f) => f.account.name,
      segment: (f) => f.account.segment,
      status: (f) => f.account.status,
      score: (f) => f.score.total,
      silence: (f) => f.account.jours_silence,
    },
    "score"
  );

  function planCall(followUp: PhoneFollowUp, index: number) {
    const dueDate = weekdays[index % weekdays.length];
    const supabase = createClient();
    startTransition(async () => {
      const { error } = await supabase.from("account_actions").insert({
        account_id: followUp.account.id,
        type: "relance",
        content: `Relance téléphonique — appeler pour planifier une visite (${followUp.reason})`,
        due_date: dueDate,
      });
      if (!error) setPlanned((prev) => new Set(prev).add(followUp.account.id));
    });
  }

  if (followUps.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted-foreground">
        Aucune relance téléphonique à prévoir cette semaine — tous les comptes actifs ont été contactés récemment ou ont déjà une action planifiée.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <SortableTh label="Compte" sortKey="name" activeKey={sortKey} dir={dir} onSort={toggle} className="px-5" />
            <SortableTh label="Seg" sortKey="segment" activeKey={sortKey} dir={dir} onSort={toggle} />
            <SortableTh label="Statut" sortKey="status" activeKey={sortKey} dir={dir} onSort={toggle} />
            <SortableTh label="Score" sortKey="score" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
            <SortableTh label="Silence (j)" sortKey="silence" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
            <th className="px-3 py-3 font-medium">Motif</th>
            <th className="px-5 py-3 font-medium text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((f, i) => {
            const isPlanned = planned.has(f.account.id);
            return (
              <tr key={f.account.id} className="border-b border-border last:border-0 hover:bg-surface-muted">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Link href={`/comptes/${f.account.id}`} className="font-medium text-foreground hover:text-primary">
                      {f.account.name}
                    </Link>
                    <ScoreBadge score={f.score.total} />
                  </div>
                  <p className="text-xs text-muted-foreground">{f.account.city ?? "Ville inconnue"}</p>
                </td>
                <td className="px-3 py-3"><SegmentBadge segment={f.account.segment} /></td>
                <td className="px-3 py-3"><StatusBadge status={f.account.status} /></td>
                <td className="px-3 py-3 text-right font-medium text-foreground">{f.score.total}/100</td>
                <td className="px-3 py-3 text-right text-muted-foreground">{formatNumber(f.account.jours_silence)}</td>
                <td className="px-3 py-3 text-xs text-muted-foreground">{f.reason}</td>
                <td className="px-5 py-3 text-right">
                  <button
                    onClick={() => planCall(f, i)}
                    disabled={isPending || isPlanned}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-60"
                  >
                    {isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : isPlanned ? (
                      <CheckCircle2 size={13} className="text-success" />
                    ) : (
                      <Phone size={13} />
                    )}
                    {isPlanned ? "Planifié" : "Planifier l'appel"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
