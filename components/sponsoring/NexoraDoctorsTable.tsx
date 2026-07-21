"use client";

import { useMemo, useState } from "react";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR } from "@/lib/utils";

export interface NexoraDoctor {
  key: string;
  medecin: string;
  specialite: string | null;
  structure: string | null;
  departement: string | null;
  labos: string[];
  montant: number | null;
  dansSalesforce: boolean;
}

type SortKey = "medecin" | "specialite" | "departement" | "montant" | "statut";

export function NexoraDoctorsTable({ doctors }: { doctors: NexoraDoctor[] }) {
  const [onlyAbsent, setOnlyAbsent] = useState(false);

  const filtered = useMemo(
    () => (onlyAbsent ? doctors.filter((d) => !d.dansSalesforce) : doctors),
    [doctors, onlyAbsent]
  );

  const { sorted, sortKey, dir, toggle } = useSortableTable<NexoraDoctor, SortKey>(
    filtered,
    {
      medecin: (d) => d.medecin,
      specialite: (d) => d.specialite,
      departement: (d) => d.departement,
      montant: (d) => d.montant,
      statut: (d) => (d.dansSalesforce ? 1 : 0),
    },
    "montant"
  );

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border bg-surface-muted px-5 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={onlyAbsent}
            onChange={(e) => setOnlyAbsent(e.target.checked)}
            className="accent-primary"
          />
          Uniquement les médecins absents de mon Salesforce
        </label>
        <span className="text-xs text-muted-foreground">{sorted.length} médecin(s)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <SortableTh label="Médecin" sortKey="medecin" activeKey={sortKey} dir={dir} onSort={toggle} className="px-5" />
              <SortableTh label="Spécialité" sortKey="specialite" activeKey={sortKey} dir={dir} onSort={toggle} />
              <th className="px-3 py-3 font-medium">Structure</th>
              <SortableTh label="Dépt" sortKey="departement" activeKey={sortKey} dir={dir} onSort={toggle} />
              <th className="px-3 py-3 font-medium">Labo(s)</th>
              <SortableTh label="Montant" sortKey="montant" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
              <SortableTh label="Statut" sortKey="statut" activeKey={sortKey} dir={dir} onSort={toggle} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <tr key={d.key} className="border-b border-border last:border-0 hover:bg-surface-muted">
                <td className="px-5 py-3 font-medium text-foreground">{d.medecin}</td>
                <td className="px-3 py-3 text-muted-foreground">{d.specialite ?? "—"}</td>
                <td className="px-3 py-3 text-muted-foreground">{d.structure ?? "—"}</td>
                <td className="px-3 py-3 text-muted-foreground">{d.departement ?? "—"}</td>
                <td className="px-3 py-3">
                  {d.labos.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {d.labos.map((l) => (
                        <span key={l} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">{l}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right font-medium text-foreground">{d.montant != null ? formatEUR(d.montant) : "—"}</td>
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
                <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                  Aucun médecin Nexora — cliquez « Synchroniser le sponsoring Nexora » sur la page Import.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
