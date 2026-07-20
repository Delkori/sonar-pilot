"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { AccountForecast } from "@/types/database";
import { Plus, Trash2, Loader2 } from "lucide-react";

const MONTH_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

export function ForecastPanel({ accountId, initialForecasts }: { accountId: string; initialForecasts: AccountForecast[] }) {
  const [forecasts, setForecasts] = useState(
    [...initialForecasts].sort((a, b) => a.year - b.year || a.month - b.month)
  );
  const [isPending, startTransition] = useTransition();
  const now = new Date();
  const [newYear, setNewYear] = useState(now.getFullYear());
  const [newMonth, setNewMonth] = useState(now.getMonth() + 1);

  function addForecast() {
    if (forecasts.some((f) => f.year === newYear && f.month === newMonth)) return;
    const supabase = createClient();
    startTransition(async () => {
      const { data, error } = await supabase
        .from("account_forecasts")
        .insert({ account_id: accountId, year: newYear, month: newMonth, boites_prevues: 0, ca_prevu: 0 })
        .select()
        .single();
      if (!error && data) {
        setForecasts((prev) => [...prev, data as AccountForecast].sort((a, b) => a.year - b.year || a.month - b.month));
      }
    });
  }

  function updateForecast(id: string, patch: Partial<Pick<AccountForecast, "boites_prevues" | "ca_prevu" | "note">>) {
    setForecasts((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    const supabase = createClient();
    startTransition(async () => {
      await supabase.from("account_forecasts").update(patch).eq("id", id);
    });
  }

  function removeForecast(id: string) {
    setForecasts((prev) => prev.filter((f) => f.id !== id));
    const supabase = createClient();
    startTransition(async () => {
      await supabase.from("account_forecasts").delete().eq("id", id);
    });
  }

  const totalBoites = forecasts.reduce((s, f) => s + (f.boites_prevues ?? 0), 0);
  const totalCa = forecasts.reduce((s, f) => s + (f.ca_prevu ?? 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <select
          value={newMonth}
          onChange={(e) => setNewMonth(Number(e.target.value))}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
        >
          {MONTH_LABELS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <input
          type="number"
          value={newYear}
          onChange={(e) => setNewYear(Number(e.target.value))}
          className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
        />
        <button
          onClick={addForecast}
          disabled={isPending}
          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
        >
          <Plus size={14} /> Ajouter une prévision
        </button>
        {isPending && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
        <span className="ml-auto text-xs text-muted-foreground">
          Total prévu : {formatNumber(totalBoites)} boîtes · {formatEUR(totalCa)}
        </span>
      </div>

      {forecasts.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Aucune prévision — ajoutez un mois ci-dessus pour construire votre plan d&apos;action.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Mois</th>
              <th className="px-3 py-2 font-medium text-right">Boîtes prévues</th>
              <th className="px-3 py-2 font-medium text-right">CA prévu</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {forecasts.map((f) => (
              <tr key={f.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-foreground">{MONTH_LABELS[f.month - 1]} {f.year}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    defaultValue={f.boites_prevues ?? 0}
                    onBlur={(e) => updateForecast(f.id, { boites_prevues: Number(e.target.value) })}
                    className="w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-border focus:border-primary focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    defaultValue={f.ca_prevu ?? 0}
                    onBlur={(e) => updateForecast(f.id, { ca_prevu: Number(e.target.value) })}
                    className="w-28 rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-border focus:border-primary focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    defaultValue={f.note ?? ""}
                    placeholder="ex. offre prévue, RDV programmé..."
                    onBlur={(e) => updateForecast(f.id, { note: e.target.value || null })}
                    className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-primary focus:outline-none"
                  />
                </td>
                <td className="px-2 py-2">
                  <button onClick={() => removeForecast(f.id)} className="text-muted-foreground hover:text-danger">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
