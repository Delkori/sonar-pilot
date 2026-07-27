"use client";

import Link from "next/link";
import { SortableTh } from "@/components/ui/SortableTh";
import { useSortableTable } from "@/lib/hooks/useSortableTable";
import { formatEUR, formatNumber, formatPct } from "@/lib/utils";
import { PERSONA_COLORS } from "@/lib/persona";
import type { PersonaModel, Persona } from "@/lib/persona";

export interface PersonaAccountRow {
  id: string;
  name: string;
  persona: Persona | null;
  ca: number;
  recos: string[];
}

type SortKey = "name" | "persona" | "ca" | "recos";

export function PersonaClient({ models, rows }: { models: PersonaModel[]; rows: PersonaAccountRow[] }) {
  const { sorted, sortKey, dir, toggle } = useSortableTable<PersonaAccountRow, SortKey>(
    rows,
    {
      name: (r) => r.name,
      persona: (r) => r.persona,
      ca: (r) => r.ca,
      recos: (r) => r.recos.length,
    },
    "recos"
  );

  return (
    <div className="space-y-6">
      {/* ── Modèles types par persona ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {models.map((m) => (
          <div key={m.persona} className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: PERSONA_COLORS[m.persona] }} />
              <h3 className="text-sm font-semibold text-foreground">{m.persona}</h3>
            </div>
            <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
              <span>{formatNumber(m.accountCount)} comptes</span>
              <span>CA moy. {formatEUR(m.accountCount > 0 ? m.caTotal / m.accountCount : 0)}</span>
            </div>
            {m.brands.length === 0 ? (
              <p className="text-xs text-muted-foreground">Pas encore de données produit pour ce persona.</p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Modèle type (réfs les plus achetées)</p>
                {m.brands.slice(0, 6).map((b, i) => (
                  <div key={b.brand}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">#{i + 1} {b.brand}</span>
                      <span className="text-muted-foreground">{formatPct(b.penetration)} · méd. {formatNumber(b.medianQty)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-muted">
                      <div className="h-1.5 rounded-full" style={{ width: `${b.penetration * 100}%`, backgroundColor: PERSONA_COLORS[m.persona] }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Comptes + recommandations d'écart au modèle ── */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-3">
          <p className="text-sm font-semibold text-foreground">Comptes & recommandations</p>
          <p className="text-xs text-muted-foreground">
            Références que les pairs du même persona achètent majoritairement, mais que le compte n&apos;a pas encore — à
            proposer pour préparer le trimestre.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <SortableTh label="Compte" sortKey="name" activeKey={sortKey} dir={dir} onSort={toggle} className="px-5" />
                <SortableTh label="Persona" sortKey="persona" activeKey={sortKey} dir={dir} onSort={toggle} />
                <SortableTh label="CA YTD" sortKey="ca" activeKey={sortKey} dir={dir} onSort={toggle} align="right" />
                <SortableTh label="À proposer" sortKey="recos" activeKey={sortKey} dir={dir} onSort={toggle} className="px-5" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-muted">
                  <td className="px-5 py-3">
                    <Link href={`/comptes/${r.id}`} className="font-medium text-foreground hover:text-primary">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    {r.persona ? (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                        style={{ backgroundColor: PERSONA_COLORS[r.persona] }}
                      >
                        {r.persona}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Non déterminé</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{formatEUR(r.ca)}</td>
                  <td className="px-5 py-3">
                    {r.recos.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {r.recos.map((b) => (
                          <span key={b} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">{b}</span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">
                    Aucun compte avec persona déterminé — importez les médecins (Salesforce) et vérifiez la connexion Nexora.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
