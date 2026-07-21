"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AccountAction } from "@/types/database";
import { CheckCircle2, Circle, MessageSquare, Target, CalendarClock } from "lucide-react";

export function AccountActionsPanel({
  accountId,
  initialActions,
}: {
  accountId: string;
  initialActions: AccountAction[];
}) {
  const [actions, setActions] = useState(initialActions);
  const [content, setContent] = useState("");
  const [type, setType] = useState<"commentaire" | "action" | "relance" | "offre">("commentaire");
  const [dueDate, setDueDate] = useState("");
  const [isPending, startTransition] = useTransition();

  function addAction() {
    if (!content.trim()) return;
    const supabase = createClient();
    startTransition(async () => {
      const { data } = await supabase
        .from("account_actions")
        .insert({
          account_id: accountId,
          type,
          content: content.trim(),
          due_date: type !== "commentaire" && dueDate ? dueDate : null,
        })
        .select()
        .single();
      if (data) setActions((prev) => [data as AccountAction, ...prev]);
      setContent("");
      setDueDate("");
    });
  }

  function toggleDone(action: AccountAction) {
    const supabase = createClient();
    startTransition(async () => {
      await supabase.from("account_actions").update({ done: !action.done }).eq("id", action.id);
      setActions((prev) => prev.map((a) => (a.id === action.id ? { ...a, done: !a.done } : a)));
    });
  }

  const needsDate = type === "action" || type === "relance" || type === "offre";

  return (
    <div>
      <div className="flex flex-wrap gap-2 border-b border-border p-4">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as "commentaire" | "action" | "relance" | "offre")}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
        >
          <option value="commentaire">Commentaire</option>
          <option value="action">Action</option>
          <option value="relance">Relance</option>
          <option value="offre">Offre</option>
        </select>
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addAction()}
          placeholder="Ajouter un commentaire, une action ou une relance..."
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
        {needsDate && (
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            title="Échéance (apparaît dans le Calendrier)"
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
          />
        )}
        <button
          onClick={addAction}
          disabled={isPending}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
        >
          Ajouter
        </button>
      </div>

      <ul className="divide-y divide-border">
        {actions.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">Aucun commentaire ni action pour le moment.</li>
        )}
        {actions.map((a) => (
          <li key={a.id} className="flex items-start gap-3 px-4 py-3">
            {a.type !== "commentaire" ? (
              <button onClick={() => toggleDone(a)} className="mt-0.5 text-primary">
                {a.done ? <CheckCircle2 size={18} /> : <Circle size={18} className="text-muted-foreground" />}
              </button>
            ) : (
              <MessageSquare size={18} className="mt-0.5 text-muted-foreground" />
            )}
            <div className="flex-1">
              <p className={`text-sm ${a.done ? "text-muted-foreground line-through" : "text-foreground"}`}>{a.content}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                {a.type === "action" ? "Action" : a.type === "relance" ? "Relance" : a.type === "offre" ? "Offre" : "Commentaire"} ·{" "}
                {new Date(a.created_at).toLocaleDateString("fr-FR")}
                {a.due_date && (
                  <span className="flex items-center gap-1 text-primary">
                    <CalendarClock size={11} /> {new Date(a.due_date).toLocaleDateString("fr-FR")}
                  </span>
                )}
              </p>
            </div>
            {a.type !== "commentaire" && !a.done && <Target size={14} className="mt-1 text-warning" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
