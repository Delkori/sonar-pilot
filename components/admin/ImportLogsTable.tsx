"use client";

import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import type { Import } from "@/types/database";

type SortKey = "date" | "filename" | "status" | "rows_total" | "rows_success" | "rows_error";

export function ImportLogsTable({ imports }: { imports: Import[] }) {
  const { sorted, sortKey, dir, toggle } = useSortableTable<Import, SortKey>(
    imports,
    {
      date: (i) => i.imported_at,
      filename: (i) => i.filename,
      status: (i) => i.status,
      rows_total: (i) => i.rows_total,
      rows_success: (i) => i.rows_success,
      rows_error: (i) => i.rows_error,
    },
    "date"
  );

  if (imports.length === 0) {
    return <p className="px-5 py-6 text-center text-sm text-muted-foreground">Aucun import réalisé pour le moment.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
          <SortableTh label="Date" sortKey="date" activeKey={sortKey} dir={dir} onSort={toggle} className="px-5" />
          <SortableTh label="Fichier" sortKey="filename" activeKey={sortKey} dir={dir} onSort={toggle} />
          <SortableTh label="Statut" sortKey="status" activeKey={sortKey} dir={dir} onSort={toggle} />
          <SortableTh label="Lignes" sortKey="rows_total" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
          <SortableTh label="Succès" sortKey="rows_success" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
          <SortableTh label="Erreurs" sortKey="rows_error" activeKey={sortKey} dir={dir} onSort={toggle} align="right" className="px-5" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((imp) => (
          <tr key={imp.id} className="border-b border-border last:border-0">
            <td className="px-5 py-3 text-muted-foreground">{new Date(imp.imported_at).toLocaleString("fr-FR")}</td>
            <td className="px-3 py-3">{imp.filename}</td>
            <td className="px-3 py-3">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  imp.status === "success"
                    ? "bg-green-50 text-green-700"
                    : imp.status === "partial"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-rose-50 text-rose-700"
                }`}
              >
                {imp.status}
              </span>
            </td>
            <td className="px-3 py-3 text-right text-muted-foreground">{imp.rows_total}</td>
            <td className="px-3 py-3 text-right">{imp.rows_success}</td>
            <td className="px-5 py-3 text-right text-danger">{imp.rows_error}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
