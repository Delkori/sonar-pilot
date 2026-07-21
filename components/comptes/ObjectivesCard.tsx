"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatNumber } from "@/lib/utils";
import type { Account } from "@/types/database";
import { Loader2 } from "lucide-react";

/**
 * Depuis que le PAS ne fournit plus d'objectif, celui-ci se saisit à la
 * main ici — total, filler et cosmétique séparément, comme le fait
 * l'utilisateur dans son suivi. Sauvegarde au blur, pas de bouton.
 */
export function ObjectivesCard({ account }: { account: Account }) {
  const [values, setValues] = useState({
    objectif_boites: account.objectif_boites ?? 0,
    objectif_filler: account.objectif_filler ?? 0,
    objectif_cosmetique: account.objectif_cosmetique ?? 0,
  });
  const [isPending, startTransition] = useTransition();

  function save(field: keyof typeof values, value: number) {
    setValues((prev) => ({ ...prev, [field]: value }));
    const supabase = createClient();
    const patch: Partial<Account> = { [field]: value } as Partial<Account>;
    startTransition(async () => {
      await supabase.from("accounts").update(patch).eq("id", account.id);
    });
  }

  const realise = account.realise_boites ?? 0;
  const ecart = realise - values.objectif_boites;
  const atteinte = values.objectif_boites > 0 ? realise / values.objectif_boites : 0;

  return (
    <div className="space-y-3 text-sm">
      <ObjectiveRow label="Objectif total" value={values.objectif_boites} onSave={(v) => save("objectif_boites", v)} />
      <ObjectiveRow label="dont Filler" value={values.objectif_filler} onSave={(v) => save("objectif_filler", v)} />
      <ObjectiveRow
        label="dont Cosmétique"
        value={values.objectif_cosmetique}
        onSave={(v) => save("objectif_cosmetique", v)}
      />
      <div className="flex justify-between border-t border-border pt-3">
        <span className="text-muted-foreground">Réalisé (boîtes)</span>
        <span className="font-medium text-foreground">{formatNumber(realise)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Écart</span>
        <span className={`font-medium ${ecart < 0 ? "text-danger" : "text-success"}`}>
          {ecart > 0 ? "+" : ""}
          {formatNumber(ecart)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">% Atteinte</span>
        <span className="font-medium text-foreground">{Math.round(atteinte * 100)}%</span>
      </div>
      {isPending && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
    </div>
  );
}

function ObjectiveRow({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        defaultValue={value}
        onBlur={(e) => onSave(Number(e.target.value))}
        className="w-24 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-right font-medium text-foreground hover:border-border focus:border-primary focus:outline-none"
      />
    </div>
  );
}
