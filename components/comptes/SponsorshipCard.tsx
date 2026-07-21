"use client";

import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR } from "@/lib/utils";

export interface SponsorshipRow {
  id: string;
  medecin: string;
  laboratoire: string;
  montant: number | null;
}

type SortKey = "medecin" | "laboratoire" | "montant";

/**
 * Sponsoring des médecins du compte par les laboratoires (Transparence
 * Santé via Nexora, rapproché par RPPS) : montant cumulé déclaré par labo.
 */
export function SponsorshipCard({ rows }: { rows: SponsorshipRow[] }) {
  const { sorted, sortKey, dir, toggle } = useSortableTable<SponsorshipRow, SortKey>(
    rows,
    {
      medecin: (r) => r.medecin,
      laboratoire: (r) => r.laboratoire,
      montant: (r) => r.montant,
    },
    "montant"
  );

  const total = rows.reduce((s, r) => s + (r.montant ?? 0), 0);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
          <SortableTh label="Médecin" sortKey="medecin" activeKey={sortKey} dir={dir} onSort={toggle} className="px-0" />
          <SortableTh label="Laboratoire" sortKey="laboratoire" activeKey={sortKey} dir={dir} onSort={toggle} className="px-0" />
          <SortableTh label="Montant déclaré" sortKey="montant" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-0" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.id} className="border-b border-border last:border-0">
            <td className="py-2 font-medium text-foreground">{r.medecin}</td>
            <td className="py-2">{r.laboratoire}</td>
            <td className="py-2 text-right font-medium text-foreground">{r.montant != null ? formatEUR(r.montant) : "—"}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-border">
          <td colSpan={2} className="py-2 text-right text-xs font-medium text-muted-foreground">Total sponsoring déclaré</td>
          <td className="py-2 text-right font-semibold text-foreground">{formatEUR(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
