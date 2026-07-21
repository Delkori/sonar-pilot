"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Account, NameMatchCandidate } from "@/types/database";
import { Check, X, Loader2 } from "lucide-react";

export function MatchReviewPanel({
  candidates,
  accounts,
}: {
  candidates: NameMatchCandidate[];
  accounts: Account[];
}) {
  const [items, setItems] = useState(candidates);
  const [busy, setBusy] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<string, string>>({});

  async function confirm(candidate: NameMatchCandidate, accountId: string) {
    setBusy(candidate.id);
    const supabase = createClient();
    await supabase.from("name_aliases").insert({
      raw_name: candidate.raw_name,
      account_id: accountId,
      confidence: candidate.confidence,
    });
    await supabase.from("name_match_candidates").update({ status: "confirmed" }).eq("id", candidate.id);
    setItems((prev) => prev.filter((c) => c.id !== candidate.id));
    setBusy(null);
  }

  async function reject(candidate: NameMatchCandidate) {
    setBusy(candidate.id);
    const supabase = createClient();
    await supabase.from("name_match_candidates").update({ status: "rejected" }).eq("id", candidate.id);
    setItems((prev) => prev.filter((c) => c.id !== candidate.id));
    setBusy(null);
  }

  if (items.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        Aucune correspondance en attente — tous les noms des dernières factures ont été rapprochés.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border">
      {items.map((c) => {
        const chosenId = selection[c.id] ?? c.candidate_account_id ?? "";
        return (
          <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
            <div className="min-w-48 flex-1">
              <p className="text-sm font-medium text-foreground">&quot;{c.raw_name}&quot;</p>
              <p className="text-xs text-muted-foreground">
                {c.candidate_name
                  ? `Meilleure hypothèse : ${c.candidate_name} (confiance ${Math.round((c.confidence ?? 0) * 100)}%)`
                  : "Aucune correspondance trouvée dans le référentiel"}
              </p>
            </div>
            <select
              value={chosenId}
              onChange={(e) => setSelection((prev) => ({ ...prev, [c.id]: e.target.value }))}
              className="min-w-56 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
            >
              <option value="">— Choisir un compte —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button
              onClick={() => chosenId && confirm(c, chosenId)}
              disabled={!chosenId || busy === c.id}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
            >
              {busy === c.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Confirmer
            </button>
            <button
              onClick={() => reject(c)}
              disabled={busy === c.id}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-muted disabled:opacity-50"
            >
              <X size={14} />
              Ce n&apos;est pas un compte existant
            </button>
          </div>
        );
      })}
    </div>
  );
}
