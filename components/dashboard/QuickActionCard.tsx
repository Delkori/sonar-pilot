"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import type { Account } from "@/types/database";
import { CheckCircle2, Loader2, Plus } from "lucide-react";

type ActionType = "commentaire" | "action" | "relance" | "offre";

/**
 * Saisie rapide depuis le dashboard : choisir un compte, un type
 * (commentaire / action / relance / offre) et l'enregistrer directement —
 * ça alimente le plan d'action de la fiche et, si daté, le Calendrier.
 */
export function QuickActionCard({ accounts }: { accounts: Account[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ActionType>("action");
  const [content, setContent] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  const match = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return accounts.find((a) => a.name.toLowerCase() === q) ?? accounts.find((a) => a.name.toLowerCase().includes(q)) ?? null;
  }, [query, accounts]);

  const needsDate = type !== "commentaire";

  function submit() {
    if (!match || !content.trim()) return;
    const supabase = createClient();
    startTransition(async () => {
      const { error } = await supabase.from("account_actions").insert({
        account_id: match!.id,
        type,
        content: content.trim(),
        due_date: needsDate && dueDate ? dueDate : null,
      });
      if (!error) {
        setDone(`Ajouté sur ${match!.name}`);
        setContent("");
        setDueDate("");
        setQuery("");
        setTimeout(() => setDone(null), 4000);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Saisie rapide</CardTitle>
        <CardDescription>Commentaire, action, relance ou offre sur un compte</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <input
          list="quick-action-accounts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Compte (tapez pour rechercher)..."
          className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
        <datalist id="quick-action-accounts">
          {accounts.slice(0, 1000).map((a) => (
            <option key={a.id} value={a.name} />
          ))}
        </datalist>
        <div className="flex gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ActionType)}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
          >
            <option value="commentaire">Commentaire</option>
            <option value="action">Action</option>
            <option value="relance">Relance</option>
            <option value="offre">Offre</option>
          </select>
          {needsDate && (
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              title="Échéance (apparaît dans le Calendrier)"
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
          )}
        </div>
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Contenu..."
          className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={submit}
            disabled={isPending || !match || !content.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Enregistrer
          </button>
          {query && !match && <span className="text-xs text-danger">Aucun compte trouvé</span>}
          {done && (
            <span className="flex items-center gap-1 text-xs text-success">
              <CheckCircle2 size={13} /> {done}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
