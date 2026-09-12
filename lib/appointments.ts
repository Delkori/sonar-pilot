import { monthIndex } from "@/lib/dates";
import type { PlanningEventType } from "@/types/database";

/**
 * Rendez-vous d'un compte, mois par mois — pour signaler dans Planning › Mois
 * une prévision qui n'a pas de visite ni d'appel en face.
 *
 * Le mois est celui de Paris (le secteur), pas celui du serveur ni du
 * navigateur : un même événement doit tomber dans le même mois côté
 * serveur (rendu initial) et côté client (hydratation), sinon l'alerte
 * clignote au chargement.
 */

export type AppointmentType = Exclude<PlanningEventType, "admin">;

export interface Appointment {
  type: AppointmentType;
  /** Jour du mois, 1 à 31. */
  day: number;
  confirmed: boolean;
}

export type AppointmentsByAccountMonth = Map<string, Appointment[]>;

export const CONTACT_MODE_LABEL = {
  visite: "Visite à caler",
  appel: "Par téléphone",
  mail: "Par mail",
} as const;

const parisDate = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` d'un instant, vu de Paris. */
export function parisDateParts(iso: string): { year: number; month: number; day: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const [year, month, day] = parisDate.format(d).split("-").map(Number);
  return { year, month, day };
}

export function appointmentKey(accountId: string, monthIdx: number): string {
  return `${accountId}-${monthIdx}`;
}

export function appointmentsByAccountMonth(
  events: { account_id: string | null; type: PlanningEventType; start_at: string; confirmed: boolean }[]
): AppointmentsByAccountMonth {
  const map: AppointmentsByAccountMonth = new Map();
  for (const e of events) {
    if (!e.account_id || e.type === "admin") continue;
    const parts = parisDateParts(e.start_at);
    if (!parts) continue;
    const key = appointmentKey(e.account_id, monthIndex(parts.year, parts.month));
    const list = map.get(key) ?? [];
    list.push({ type: e.type, day: parts.day, confirmed: e.confirmed });
    map.set(key, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.day - b.day);
  return map;
}

export const APPOINTMENT_LABEL: Record<AppointmentType, string> = {
  visite: "Visite",
  visite_prospect: "Visite prospect",
  appel: "Appel",
};
