"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatEUR, formatNumber } from "@/lib/utils";
import { suggestMonthlyForecast } from "@/lib/forecast";
import type { Account, AccountForecast, ForecastKind } from "@/types/database";
import { Plus, Trash2, Loader2, Sparkles, CalendarRange } from "lucide-react";

const MONTH_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

export function ForecastPanel({
  accountId,
  account,
  initialForecasts,
  kind,
}: {
  accountId: string;
  account: Account;
  initialForecasts: AccountForecast[];
  kind: ForecastKind;
}) {
  const [forecasts, setForecasts] = useState(
    initialForecasts.filter((f) => f.kind === kind).sort((a, b) => a.year - b.year || a.month - b.month)
  );
  const [isPending, startTransition] = useTransition();
  const now = new Date();
  const [newYear, setNewYear] = useState(now.getFullYear());
  const [newMonth, setNewMonth] = useState(now.getMonth() + 1);
  const [annualTotal, setAnnualTotal] = useState("");

  function addForecast() {
    if (forecasts.some((f) => f.year === newYear && f.month === newMonth)) return;
    const supabase = createClient();
    startTransition(async () => {
      const { data, error } = await supabase
        .from("account_forecasts")
        .insert({ account_id: accountId, year: newYear, month: newMonth, kind, boites_prevues: 0, ca_prevu: 0 })
        .select()
        .single();
      if (!error && data) {
        setForecasts((prev) => [...prev, data as AccountForecast].sort((a, b) => a.year - b.year || a.month - b.month));
      }
    });
  }

  function suggestNext3Months() {
    const targetMonths: { year: number; month: number }[] = [];
    let y = now.getFullYear();
    let m = now.getMonth() + 1;
    for (let i = 0; i < 3; i++) {
      if (!forecasts.some((f) => f.year === y && f.month === m)) targetMonths.push({ year: y, month: m });
      m++;
      if (m > 12) { m = 1; y++; }
    }
    if (targetMonths.length === 0) return;

    const suggestions = suggestMonthlyForecast(account, targetMonths);
    const supabase = createClient();
    startTransition(async () => {
      const { data, error } = await supabase
        .from("account_forecasts")
        .insert(suggestions.map((s) => ({ account_id: accountId, kind, ...s })))
        .select();
      if (!error && data) {
        setForecasts((prev) =>
          [...prev, ...(data as AccountForecast[])].sort((a, b) => a.year - b.year || a.month - b.month)
        );
      }
    });
  }

  function splitAnnualObjective() {
    const total = Number(annualTotal);
    if (!total || total <= 0) return;
    const perMonth = Math.round(total / 12);
    const rows = Array.from({ length: 12 }, (_, i) => ({
      account_id: accountId,
      year: newYear,
      month: i + 1,
      kind,
      boites_prevues: perMonth,
      ca_prevu: 0,
    })).filter((r) => !forecasts.some((f) => f.year === r.year && f.month === r.month));
    if (rows.length === 0) return;
    const supabase = createClient();
    startTransition(async () => {
      const { data, error } = await supabase.from("account_forecasts").insert(rows).select();
      if (!error && data) {
        setForecasts((prev) =>
          [...prev, ...(data as AccountForecast[])].sort((a, b) => a.year - b.year || a.month - b.month)
        );
        setAnnualTotal("");
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
          <Plus size={14} /> Ajouter
        </button>
        {kind === "prevision" ? (
          <button
            onClick={suggestNext3Months}
            disabled={isPending}
            title="Propose une répartition basée sur l'objectif restant, le score et le rythme réel du compte"
            className="flex items-center gap-1 rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50"
          >
            <Sparkles size={14} /> Suggérer 3 mois
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={annualTotal}
              onChange={(e) => setAnnualTotal(e.target.value)}
              placeholder="Objectif annuel (boîtes)"
              className="w-40 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={splitAnnualObjective}
              disabled={isPending || !annualTotal}
              title="Répartit l'objectif annuel à parts égales sur les 12 mois de l'année sélectionnée"
              className="flex items-center gap-1 rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50"
            >
              <CalendarRange size={14} /> Répartir sur l&apos;année
            </button>
          </div>
        )}
        {isPending && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
        <span className="ml-auto text-xs text-muted-foreground">
          Total : {formatNumber(totalBoites)} boîtes · {formatEUR(totalCa)}
        </span>
      </div>

      {forecasts.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {kind === "objectif"
            ? "Aucun objectif défini — saisissez un objectif annuel ci-dessus pour le répartir sur les 12 mois, ou ajoutez un mois manuellement."
            : "Aucune prévision — cliquez \"Suggérer 3 mois\" pour une proposition basée sur ce compte, ou ajoutez un mois manuellement."}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Mois</th>
              <th className="px-3 py-2 font-medium text-right">Boîtes</th>
              <th className="px-3 py-2 font-medium text-right">CA</th>
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
                    placeholder={kind === "objectif" ? "ex. objectif révisé..." : "ex. offre prévue, RDV programmé..."}
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
