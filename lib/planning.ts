import type { Account, AccountForecast } from "@/types/database";
import { computeTargetingScore } from "./scoring";
import { isProspect } from "./accounts";
import { getPhoneFollowUps } from "./followups";

// Temps de trajet estimé depuis Lyon (point de départ chaque matin) vers le
// département du compte — estimation par zone, pas d'API de routage externe.
export const DEPT_TRAVEL_MINUTES: Record<string, number> = {
  "69": 25,
  "01": 45,
  "42": 60,
  "38": 60,
  "26": 90,
  "73": 90,
  "63": 90,
  "74": 105,
  "07": 105,
  "43": 120,
  "03": 120,
  "15": 150,
};
const DEFAULT_TRAVEL_MINUTES = 90;

export function travelMinutesFor(departmentCode: string | null | undefined): number {
  if (!departmentCode) return DEFAULT_TRAVEL_MINUTES;
  return DEPT_TRAVEL_MINUTES[departmentCode] ?? DEFAULT_TRAVEL_MINUTES;
}

export type PlanningEventType = "visite" | "visite_prospect" | "appel" | "admin";

export interface DraftPlanningEvent {
  account_id: string | null;
  type: PlanningEventType;
  title: string;
  note: string | null;
  start_at: Date;
  end_at: Date;
}

const VISITE_MIN = 45;
const BUFFER_MIN = 15;
const JOUR_DEBUT_H = 9;
const JOUR_FIN_H = 18;

function addMin(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60000);
}

function atHour(day: Date, h: number, m = 0): Date {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Génère un planning brut (non enregistré) pour la semaine (lundi→vendredi)
 * démarrant à `weekStart` :
 *  - Visites clients : comptes ayant une prévision (mois courant ou suivant)
 *    non encore réalisée, triés par CA prévu, regroupés par département pour
 *    limiter les trajets depuis Lyon (un département "cible" par jour).
 *  - Au moins une visite prospect par jour comportant une visite client,
 *    dans le même département si possible.
 *  - 1h d'appels (comptes à relancer, cf. getPhoneFollowUps) + 1h
 *    d'administratif/mails en fin de journée.
 * `existingAccountIds` exclut les comptes déjà planifiés cette semaine
 * (lignes manuelles ou d'une génération précédente) pour ne pas les doubler.
 */
export function generateWeeklyPlan(
  weekStart: Date,
  accounts: Account[],
  forecasts: AccountForecast[],
  actions: { account_id: string; type: string; due_date: string | null; done: boolean }[],
  existingAccountIds: Set<string>
): DraftPlanningEvent[] {
  const monthKey = (y: number, m: number) => `${y}-${m}`;
  const thisMonthKey = monthKey(weekStart.getFullYear(), weekStart.getMonth() + 1);
  const nextMonthDate = new Date(weekStart.getFullYear(), weekStart.getMonth() + 1, 1);
  const nextMonthKey = monthKey(nextMonthDate.getFullYear(), nextMonthDate.getMonth() + 1);

  const bestForecastByAccount = new Map<string, AccountForecast>();
  for (const f of forecasts) {
    if (f.kind !== "prevision") continue;
    const key = monthKey(f.year, f.month);
    if (key !== thisMonthKey && key !== nextMonthKey) continue;
    if ((f.boites_prevues ?? 0) <= 0 && (f.ca_prevu ?? 0) <= 0) continue;
    const cur = bestForecastByAccount.get(f.account_id);
    if (!cur || (f.ca_prevu ?? 0) > (cur.ca_prevu ?? 0)) bestForecastByAccount.set(f.account_id, f);
  }

  const accountById = new Map(accounts.map((a) => [a.id, a] as const));

  const clientCandidates = Array.from(bestForecastByAccount.entries())
    .map(([accountId, forecast]) => ({ account: accountById.get(accountId), forecast }))
    .filter(
      (c): c is { account: Account; forecast: AccountForecast } =>
        !!c.account && !existingAccountIds.has(c.account.id)
    )
    .sort((a, b) => (b.forecast.ca_prevu ?? 0) - (a.forecast.ca_prevu ?? 0));

  const prospectCandidates = accounts
    .filter((a) => isProspect(a) && !existingAccountIds.has(a.id))
    .sort((a, b) => computeTargetingScore(b).total - computeTargetingScore(a).total);

  const followUps = getPhoneFollowUps(
    accounts.filter((a) => !existingAccountIds.has(a.id)),
    actions as never
  );

  const events: DraftPlanningEvent[] = [];
  const usedClientIds = new Set<string>();
  const usedProspectIds = new Set<string>();

  for (let day = 0; day < 5; day++) {
    const dayDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + day);

    const nextClient = clientCandidates.find((c) => !usedClientIds.has(c.account.id));
    const targetDept = nextClient?.account.department_code ?? null;
    const travelMin = travelMinutesFor(targetDept);

    const appelStart = atHour(dayDate, JOUR_FIN_H - 2);
    const appelEnd = atHour(dayDate, JOUR_FIN_H - 1);
    const adminStart = appelEnd;
    const adminEnd = atHour(dayDate, JOUR_FIN_H);
    const visiteLimit = appelStart;

    let cursor = addMin(atHour(dayDate, JOUR_DEBUT_H), travelMin);

    const dayClients = targetDept
      ? clientCandidates.filter((c) => !usedClientIds.has(c.account.id) && c.account.department_code === targetDept)
      : [];

    let placedClientToday = false;
    for (const c of dayClients) {
      const end = addMin(cursor, VISITE_MIN);
      if (end > visiteLimit) break;
      events.push({
        account_id: c.account.id,
        type: "visite",
        title: c.account.name,
        note:
          `Prévision ${Math.round(c.forecast.ca_prevu ?? 0)}€` +
          (c.forecast.commentaire ? ` · ${c.forecast.commentaire}` : c.forecast.note ? ` · ${c.forecast.note}` : ""),
        start_at: cursor,
        end_at: end,
      });
      usedClientIds.add(c.account.id);
      placedClientToday = true;
      cursor = addMin(end, BUFFER_MIN);
    }

    if (placedClientToday) {
      const prospect =
        prospectCandidates.find((p) => !usedProspectIds.has(p.id) && (!targetDept || p.department_code === targetDept)) ??
        prospectCandidates.find((p) => !usedProspectIds.has(p.id));
      if (prospect) {
        const end = addMin(cursor, VISITE_MIN);
        if (end <= visiteLimit) {
          events.push({
            account_id: prospect.id,
            type: "visite_prospect",
            title: prospect.name,
            note: "Prospection — nouveau compte à développer",
            start_at: cursor,
            end_at: end,
          });
          usedProspectIds.add(prospect.id);
        }
      }
    }

    const callsToday = followUps.slice(day * 3, day * 3 + 3);
    events.push({
      account_id: null,
      type: "appel",
      title: "Appels téléphoniques",
      note: callsToday.length > 0 ? callsToday.map((f) => `${f.account.name} (${f.reason})`).join(" · ") : null,
      start_at: appelStart,
      end_at: appelEnd,
    });
    events.push({
      account_id: null,
      type: "admin",
      title: "Administratif / mails",
      note: null,
      start_at: adminStart,
      end_at: adminEnd,
    });
  }

  return events;
}

export function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}
