"use client";

import { useMemo, useState } from "react";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR } from "@/lib/utils";

export interface ProspectRow {
  rpps: string;
  medecin: string;
  specialite: string | null;
  ville: string | null;
  dept: string | null;
  montant: number | null;
  dansSalesforce: boolean;
}

type SortKey = "medecin" | "specialite" | "ville" | "dept" | "montant" | "statut";

export function ProspectsTable({ rows }: { rows: ProspectRow[] }) {
  const [onlyAbsent, setOnlyAbsent] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyAbsent && r.dansSalesforce) return false;
      if (q && !r.medecin.toLowerCase().includes(q) && !(r.ville ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, onlyAbsent, search]);

  const { sorted, sortKey, dir, toggle } = useSortableTable<ProspectRow, SortKey>(
    filtered,
    {
      medecin: (d) => d.medecin,
      specialite: (d) => d.specialite,
      ville: (d) => d.ville,
      dept: (d) => d.dept,
      montant: (d) => d.montant,
      statut: (d) => (d.dansSalesforce ? 1 : 0),
    },
    "montant"
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-muted px-5 py-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un médecin, une ville..."
          className="min-w-56 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={onlyAbsent}
            onChange={(e) => setOnlyAbsent(e.target.checked)}
            className="accent-primary"
          />
          Uniquement les absents de mon Salesforce
        </label>
        <span className="ml-auto text-xs text-muted-foreground">{sorted.length} médecin(s)</span>
      </div>
      <div className="max-h-[600px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <SortableTh label="Médecin" sortKey="medecin" activeKey={sortKey} dir={dir} onSort={toggle} className="px-5" />
              <SortableTh label="Spécialité" sortKey="specialite" activeKey={sortKey} dir={dir} onSort={toggle} />
              <SortableTh label="Ville" sortKey="ville" activeKey={sortKey} dir={dir} onSort={toggle} />
              <SortableTh label="Dépt" sortKey="dept" activeKey={sortKey} dir={dir} onSort={toggle} />
              <SortableTh label="Sponsoring perçu" sortKey="montant" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
              <SortableTh label="Statut" sortKey="statut" activeKey={sortKey} dir={dir} onSort={toggle} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <tr key={d.rpps} className="border-b border-border last:border-0 hover:bg-surface-muted">
                <td className="px-5 py-3 font-medium text-foreground">{d.medecin}</td>
                <td className="px-3 py-3 text-muted-foreground">{d.specialite ?? "—"}</td>
                <td className="px-3 py-3 text-muted-foreground">{d.ville ?? "—"}</td>
                <td className="px-3 py-3 text-muted-foreground">{d.dept ?? "—"}</td>
                <td className="px-3 py-3 text-right font-medium text-foreground">
                  {d.montant != null ? formatEUR(d.montant) : "—"}
                </td>
                <td className="px-3 py-3">
                  {d.dansSalesforce ? (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">Dans Salesforce</span>
                  ) : (
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">Absent</span>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                  Aucun médecin ne correspond.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
