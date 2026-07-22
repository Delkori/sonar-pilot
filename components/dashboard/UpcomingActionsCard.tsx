"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import type { Account, AccountAction } from "@/types/database";
import { CalendarClock, CheckCircle2, Clock, AlertCircle } from "lucide-react";

interface UpcomingActionsCardProps {
  actions: AccountAction[];
  accounts: Account[];
}

export function UpcomingActionsCard({ actions, accounts }: UpcomingActionsCardProps) {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const pendingActions = actions
    .filter((act) => !act.done)
    .sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    })
    .slice(0, 6);

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Actions & Relances à venir</CardTitle>
          <CardDescription>
            {actions.filter((a) => !a.done).length} action(s) planifiée(s) sur vos comptes clients
          </CardDescription>
        </div>
        <CalendarClock size={18} className="text-primary" />
      </CardHeader>
      <CardContent>
        {pendingActions.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 size={24} className="mx-auto mb-2 text-success" />
            <p>Aucune relance urgente en attente.</p>
            <p className="text-xs">Ajoutez des relances directement sur les fiches comptes.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingActions.map((act) => {
              const account = accountMap.get(act.account_id);
              const dueDate = act.due_date ? new Date(act.due_date) : null;
              const isOverdue = dueDate && dueDate < now;

              return (
                <div
                  key={act.id}
                  className="flex items-start justify-between rounded-lg border border-border p-3 transition-colors hover:bg-surface-muted/50"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {account ? (
                        <Link
                          href={`/comptes/${account.id}`}
                          className="font-medium text-foreground hover:text-primary text-sm"
                        >
                          {account.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-sm text-foreground">Compte inconnu</span>
                      )}
                      <span className="rounded bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-700">
                        {act.type}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{act.content}</p>
                  </div>

                  <div className="text-right shrink-0 ml-3">
                    {dueDate ? (
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium ${
                          isOverdue ? "text-danger" : "text-muted-foreground"
                        }`}
                      >
                        {isOverdue ? <AlertCircle size={12} /> : <Clock size={12} />}
                        {dueDate.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sans date</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 border-t border-border pt-3 text-center">
          <Link
            href="/relances"
            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
          >
            Voir toutes les relances téléphoniques →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
