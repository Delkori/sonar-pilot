"use client";

import Link from "next/link";
import { CalendarCheck, CalendarPlus, Phone, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { addDays } from "@/lib/dates";
import { APPOINTMENT_LABEL, parisDateParts } from "@/lib/appointments";
import type { Account, PlanningEvent } from "@/types/database";

export type PlanningEventLite = Pick<PlanningEvent, "id" | "account_id" | "type" | "title" | "start_at" | "confirmed">;

const heure = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const jour = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" });

/**
 * Ce qu'il y a à faire : les rendez-vous des sept prochains jours (posés
 * dans Planning › Semaine) et les prévisions du mois qui n'ont ni
 * rendez-vous ni mode de contact décidé — celles qui risquent de rester
 * en l'air.
 */
export function WeekAheadCard({
  events,
  accountById,
  today,
  sansRendezVous,
}: {
  events: PlanningEventLite[];
  accountById: Map<string, Account>;
  /** `YYYY-MM-DD`, jour de Paris — fourni par le serveur pour un rendu identique des deux côtés. */
  today: string;
  sansRendezVous: { account: Account; ca: number }[];
}) {
  const jours = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const fenetre = new Set(jours);
  const aVenir = events
    .filter((e) => e.type !== "admin")
    .map((e) => ({ e, parts: parisDateParts(e.start_at) }))
    .filter((x): x is { e: PlanningEventLite; parts: { year: number; month: number; day: number } } => x.parts !== null)
    .map((x) => ({ ...x, key: `${x.parts.year}-${String(x.parts.month).padStart(2, "0")}-${String(x.parts.day).padStart(2, "0")}` }))
    .filter((x) => fenetre.has(x.key))
    .sort((a, b) => a.e.start_at.localeCompare(b.e.start_at));
  const parJour = new Map<string, typeof aVenir>();
  for (const x of aVenir) parJour.set(x.key, [...(parJour.get(x.key) ?? []), x]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Cette semaine</CardTitle>
          <CardDescription>
            {aVenir.length === 0 ? "Aucun rendez-vous posé sur les 7 prochains jours." : `${aVenir.length} rendez-vous sur les 7 prochains jours.`}
          </CardDescription>
        </div>
        <Link href="/planning/semaine" className="shrink-0 text-xs font-medium text-primary hover:underline">
          Ouvrir la semaine
        </Link>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        {aVenir.length > 0 && (
          <div className="space-y-2">
            {[...parJour.entries()].map(([key, items]) => (
              <div key={key}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {key === today ? "Aujourd'hui" : jour.format(new Date(`${key}T12:00:00Z`))}
                </p>
                <ul className="mt-1 space-y-1">
                  {items.slice(0, 6).map(({ e }) => {
                    const account = e.account_id ? accountById.get(e.account_id) : undefined;
                    const Icon = e.type === "appel" ? Phone : CalendarCheck;
                    return (
                      <li key={e.id} className="flex items-center gap-2 text-sm">
                        <span className="w-11 shrink-0 tabular-nums text-xs text-muted-foreground">{heure.format(new Date(e.start_at))}</span>
                        <Icon size={13} className={e.confirmed ? "shrink-0 text-success" : "shrink-0 text-muted-foreground"} />
                        {account ? (
                          <Link href={`/comptes/${account.id}`} className="truncate text-foreground hover:text-primary">
                            {account.name}
                          </Link>
                        ) : (
                          <span className="truncate text-foreground">{e.title}</span>
                        )}
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                          {APPOINTMENT_LABEL[e.type as keyof typeof APPOINTMENT_LABEL] ?? e.type}
                          {!e.confirmed ? " · à confirmer" : ""}
                        </span>
                      </li>
                    );
                  })}
                  {items.length > 6 && <li className="text-xs text-muted-foreground">+{items.length - 6} autre(s)</li>}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className={sansRendezVous.length > 0 ? "rounded-lg bg-warning/10 px-3 py-2" : "rounded-lg bg-surface-muted px-3 py-2"}>
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            {sansRendezVous.length > 0 ? <TriangleAlert size={13} className="text-warning" /> : <CalendarPlus size={13} className="text-muted-foreground" />}
            {sansRendezVous.length === 0
              ? "Toutes les prévisions du mois ont un rendez-vous ou un mode de contact."
              : `${sansRendezVous.length} prévision${sansRendezVous.length > 1 ? "s" : ""} du mois sans rendez-vous ni mode de contact`}
          </p>
          {sansRendezVous.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {sansRendezVous.slice(0, 5).map(({ account, ca }) => (
                <li key={account.id} className="flex items-center justify-between text-xs">
                  <Link href={`/comptes/${account.id}`} className="truncate text-foreground hover:text-primary">
                    {account.name}
                  </Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{Math.round(ca).toLocaleString("fr-FR")} €</span>
                </li>
              ))}
              {sansRendezVous.length > 5 && (
                <li className="text-xs text-muted-foreground">
                  <Link href="/planning" className="text-primary hover:underline">
                    +{sansRendezVous.length - 5} autre(s) dans Planning › Mois
                  </Link>
                </li>
              )}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
