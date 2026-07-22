"use client";

import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { SectorObjective } from "@/types/database";
import { Loader2, CalendarRange } from "lucide-react";

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function SectorObjectivesEditor({ initial }: { initial: SectorObjective[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState<SectorObjective[]>(initial);
  const [isPending, startTransition] = useTransition();
  const [annualCa, setAnnualCa] = useState("");

  const byMonth = useMemo(() => {
    const m = new Map<number, SectorObjective>();
    for (const r of rows) if (r.year === year) m.set(r.month, r);
    return m;
  }, [rows, year]);

  const totalCa = useMemo(
    () => rows.filter((r) => r.year === year).reduce((s, r) => s + (r.objectif_ca ?? 0), 0),
    [rows, year]
  );
  const totalBoites = useMemo(
    () => rows.filter((r) => r.year === year).reduce((s, r) => s + (r.objectif_boites ?? 0), 0),
    [rows, year]
  );

  function save(month: number, patch: Partial<Pick<SectorObjective, "objectif_ca" | "objectif_boites">>) {
    const existing = byMonth.get(month);
    const merged = {
      year,
      month,
      objectif_ca: patch.objectif_ca ?? existing?.objectif_ca ?? 0,
      objectif_boites: patch.objectif_boites ?? existing?.objectif_boites ?? 0,
    };
    setRows((prev) => {
      const others = prev.filter((r) => !(r.year === year && r.month === month));
      return [...others, { id: existing?.id ?? `${year}-${month}`, updated_at: "", ...merged }];
    });
    const supabase = createClient();
    startTransition(async () => {
      await supabase.from("sector_objectives").upsert(merged, { onConflict: "year,month" });
    });
  }

  function splitAnnual() {
    const total = Number(annualCa);
    if (!total || total <= 0) return;
    const perMonth = Math.round(total / 12);
    const payload = Array.from({ length: 12 }, (_, i) => ({
      year,
      month: i + 1,
      objectif_ca: perMonth,
      objectif_boites: byMonth.get(i + 1)?.objectif_boites ?? 0,
    }));
    setRows((prev) => {
      const others = prev.filter((r) => r.year !== year);
      return [...others, ...payload.map((p) => ({ id: `${p.year}-${p.month}`, updated_at: "", ...p }))];
    });
    const supabase = createClient();
    startTransition(async () => {
      await supabase.from("sector_objectives").upsert(payload, { onConflict: "year,month" });
      setAnnualCa("");
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
        />
        <input
          type="number"
          value={annualCa}
          onChange={(e) => setAnnualCa(e.target.value)}
          placeholder="Objectif CA annuel (€)"
          className="w-44 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
        />
        <button
          onClick={splitAnnual}
          disabled={isPending || !annualCa}
          title="Répartit l'objectif annuel à parts égales sur les 12 mois"
          className="flex items-center gap-1 rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50"
        >
          <CalendarRange size={14} /> Répartir sur l&apos;année
        </button>
        {isPending && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
        <span className="ml-auto text-xs text-muted-foreground">
          Total {year} : {formatEUR(totalCa)} · {formatNumber(totalBoites)} boîtes
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">Mois</th>
            <th className="px-3 py-2 font-medium text-right">Objectif CA (€)</th>
            <th className="px-3 py-2 font-medium text-right">Objectif boîtes</th>
          </tr>
        </thead>
        <tbody>
          {MONTHS.map((label, i) => {
            const m = i + 1;
            const row = byMonth.get(m);
            return (
              <tr key={m} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-foreground">{label}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    defaultValue={row?.objectif_ca ?? 0}
                    onBlur={(e) => save(m, { objectif_ca: Number(e.target.value) })}
                    className="w-32 rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-border focus:border-primary focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    defaultValue={row?.objectif_boites ?? 0}
                    onBlur={(e) => save(m, { objectif_boites: Number(e.target.value) })}
                    className="w-28 rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-border focus:border-primary focus:outline-none"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
