import type { Import } from "@/types/database";

export function ImportLogsTable({ imports }: { imports: Import[] }) {
  if (imports.length === 0) {
    return <p className="px-5 py-6 text-center text-sm text-muted-foreground">Aucun import réalisé pour le moment.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="px-5 py-3 font-medium">Date</th>
          <th className="px-3 py-3 font-medium">Fichier</th>
          <th className="px-3 py-3 font-medium">Statut</th>
          <th className="px-3 py-3 font-medium text-right">Lignes</th>
          <th className="px-3 py-3 font-medium text-right">Succès</th>
          <th className="px-5 py-3 font-medium text-right">Erreurs</th>
        </tr>
      </thead>
      <tbody>
        {imports.map((imp) => (
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
