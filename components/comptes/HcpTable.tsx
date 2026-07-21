"use client";

import { SegmentBadge } from "@/components/ui/Badge";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { Hcp } from "@/types/database";

type SortKey = "name" | "segment" | "rpps" | "potentiel" | "prev";

export function HcpTable({
  hcps,
  allocation,
}: {
  hcps: Hcp[];
  /** Part de la prévision à venir (kind='prevision') attribuée à chaque médecin. */
  allocation?: Map<string, { boites: number; ca: number }>;
}) {
  const showPrev = allocation !== undefined && allocation.size > 0;
  const { sorted, sortKey, dir, toggle } = useSortableTable<Hcp, SortKey>(
    hcps,
    {
      name: (h) => h.name,
      segment: (h) => h.segment,
      rpps: (h) => h.rpps,
      potentiel: (h) => h.potentiel_boites,
      prev: (h) => allocation?.get(h.id)?.ca ?? 0,
    },
    showPrev ? "prev" : "name",
    showPrev ? "desc" : "asc"
  );

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
          <SortableTh label="Nom" sortKey="name" activeKey={sortKey} dir={dir} onSort={toggle} className="px-0" />
          <SortableTh label="Seg" sortKey="segment" activeKey={sortKey} dir={dir} onSort={toggle} className="px-0" />
          <SortableTh label="RPPS" sortKey="rpps" activeKey={sortKey} dir={dir} onSort={toggle} className="px-0" />
          <SortableTh label="Potentiel (boîtes)" sortKey="potentiel" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-0" />
          {showPrev && (
            <SortableTh label="Prév. à venir" sortKey="prev" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-0" />
          )}
          <th className="py-2 font-medium">Contact</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((h) => (
          <tr key={h.id} className="border-b border-border last:border-0">
            <td className="py-2 font-medium text-foreground">{h.name}</td>
            <td className="py-2"><SegmentBadge segment={h.segment} /></td>
            <td className="py-2 text-muted-foreground">{h.rpps ?? "—"}</td>
            <td className="py-2 text-right">{formatNumber(h.potentiel_boites)}</td>
            {showPrev && (
              <td className="py-2 text-right text-muted-foreground">
                {(() => {
                  const a = allocation?.get(h.id);
                  return a && a.ca > 0 ? `${formatNumber(a.boites)} b · ${formatEUR(a.ca)}` : "—";
                })()}
              </td>
            )}
            <td className="py-2 text-muted-foreground">
              {h.email && <div>{h.email}</div>}
              {h.telephone && <div>{h.telephone}</div>}
              {!h.email && !h.telephone && "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
