import Link from "next/link";
import { SegmentBadge, StatusBadge } from "@/components/ui/Badge";
import { formatNumber } from "@/lib/utils";
import type { Account } from "@/types/database";

export function PriorityAccountsTable({ accounts }: { accounts: Account[] }) {
  if (accounts.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucun compte importé pour le moment.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="px-5 py-3 font-medium">Compte</th>
          <th className="px-3 py-3 font-medium">Seg</th>
          <th className="px-3 py-3 font-medium">Statut</th>
          <th className="px-3 py-3 font-medium text-right">Objectif</th>
          <th className="px-3 py-3 font-medium text-right">Réalisé</th>
          <th className="px-3 py-3 font-medium text-right">Écart</th>
          <th className="px-5 py-3 font-medium">Action recommandée</th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((a) => {
          const ecart = (a.realise_boites ?? 0) - (a.objectif_boites ?? 0);
          return (
            <tr key={a.id} className="border-b border-border last:border-0 hover:bg-surface-muted">
              <td className="px-5 py-3">
                <Link href={`/comptes/${a.id}`} className="font-medium text-foreground hover:text-primary">
                  {a.name}
                </Link>
                <p className="text-xs text-muted-foreground">{a.city ?? "Ville inconnue"}</p>
              </td>
              <td className="px-3 py-3"><SegmentBadge segment={a.segment} /></td>
              <td className="px-3 py-3"><StatusBadge status={a.status} /></td>
              <td className="px-3 py-3 text-right text-muted-foreground">{formatNumber(a.objectif_boites)}</td>
              <td className="px-3 py-3 text-right text-foreground">{formatNumber(a.realise_boites)}</td>
              <td className={`px-3 py-3 text-right font-medium ${ecart < 0 ? "text-danger" : "text-success"}`}>
                {ecart > 0 ? "+" : ""}{formatNumber(ecart)}
              </td>
              <td className="px-5 py-3 text-muted-foreground">{a.action_recommandee ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
