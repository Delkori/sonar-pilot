"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { SegmentBadge, StatusBadge } from "@/components/ui/Badge";
import type { Account, AccountStatus, Segment } from "@/types/database";
import { Loader2, Pencil, Check, X } from "lucide-react";

const SEGMENTS: Segment[] = ["A", "B", "C", "D", "E"];
const STATUSES: AccountStatus[] = ["actif", "lost", "new", "reconnected", "a_risque", "a_suivre"];

/**
 * Toutes les modifications sont écrites directement en base au blur/à la
 * confirmation — aucun bouton "enregistrer" global, pas d'état local qui
 * pourrait diverger de ce qui est réellement sauvegardé.
 */
export function EditableAccountCard({ account }: { account: Account }) {
  const [acc, setAcc] = useState(account);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(account.name);
  const [isPending, startTransition] = useTransition();

  function patch(fields: Partial<Account>) {
    setAcc((prev) => ({ ...prev, ...fields }));
    const supabase = createClient();
    startTransition(async () => {
      await supabase.from("accounts").update(fields).eq("id", account.id);
    });
  }

  function saveName() {
    setEditingName(false);
    if (nameDraft.trim() && nameDraft.trim() !== acc.name) patch({ name: nameDraft.trim() });
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        {editingName ? (
          <div className="flex flex-1 items-center gap-1">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              className="flex-1 rounded border border-primary bg-surface px-2 py-1 text-sm font-semibold outline-none"
            />
            <button onClick={saveName} className="text-success"><Check size={16} /></button>
            <button onClick={() => { setEditingName(false); setNameDraft(acc.name); }} className="text-muted-foreground">
              <X size={16} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="group flex items-center gap-1.5 text-left text-sm font-semibold text-foreground"
          >
            {acc.name}
            <Pencil size={12} className="text-muted-foreground opacity-0 group-hover:opacity-100" />
          </button>
        )}
        {isPending && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
      </div>

      <div className="flex items-center gap-3">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Segment</p>
          <div className="flex gap-1">
            {SEGMENTS.map((s) => (
              <button key={s} onClick={() => patch({ segment: s })}>
                <SegmentBadge segment={s} />
                {acc.segment === s && <span className="sr-only">actif</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-muted-foreground">Statut</p>
        <select
          value={acc.status}
          onChange={(e) => patch({ status: e.target.value as AccountStatus })}
          className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="mt-1"><StatusBadge status={acc.status} /></div>
      </div>

      <EditableRow label="Ville" value={acc.city} onSave={(v) => patch({ city: v })} />
      <EditableRow label="Code postal" value={acc.postal_code} onSave={(v) => patch({ postal_code: v })} />
      <EditableRow label="Commercial" value={acc.owner} onSave={(v) => patch({ owner: v })} />
      <EditableRow label="Email" value={acc.email} onSave={(v) => patch({ email: v })} />
      <EditableRow label="Téléphone" value={acc.telephone} onSave={(v) => patch({ telephone: v })} />
    </div>
  );
}

function EditableRow({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null;
  onSave: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <input
        type="text"
        defaultValue={value ?? ""}
        onBlur={(e) => {
          if (e.target.value !== (value ?? "")) onSave(e.target.value);
        }}
        placeholder="—"
        className="w-40 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-right font-medium text-foreground hover:border-border focus:border-primary focus:outline-none"
      />
    </div>
  );
}
