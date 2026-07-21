"use client";

import { SegmentBadge } from "@/components/ui/Badge";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatNumber } from "@/lib/utils";
import type { Hcp } from "@/types/database";

type SortKey = "name" | "segment" | "rpps" | "potentiel";

export function HcpTable({ hcps }: { hcps: Hcp[] }) {
  const { sorted, sortKey, dir, toggle } = useSortableTable<Hcp, SortKey>(
    hcps,
    {
      name: (h) => h.name,
      segment: (h) => h.segment,
      rpps: (h) => h.rpps,
      potentiel: (h) => h.potentiel_boites,
    },
    "name",
    "asc"
  );

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
          <SortableTh label="Nom" sortKey="name" activeKey={sortKey} dir={dir} onSort={toggle} className="px-0" />
          <SortableTh label="Seg" sortKey="segment" activeKey={sortKey} dir={dir} onSort={toggle} className="px-0" />
          <SortableTh label="RPPS" sortKey="rpps" activeKey={sortKey} dir={dir} onSort={toggle} className="px-0" />
          <SortableTh label="Potentiel (boîtes)" sortKey="potentiel" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-0" />
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
