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
// Au-delà, l'aller-retour dans la journée n'est plus réaliste — le
// département n'est pas proposé en visite automatique cette semaine-là.
const MAX_TRAVEL_MINUTES = 100;

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

export interface ExistingPlanningEvent {
  account_id: string | null;
  start_at: string;
}

/**
 * Génère un planning brut (non enregistré) pour la semaine (lundi→vendredi)
 * démarrant à `weekStart` :
 *  - Visites clients : comptes ayant une prévision (mois courant ou suivant)
 *    non encore réalisée, triés par CA prévu. Un compte n'est exclu que s'il
 *    a déjà été planifié DANS LE MÊME MOIS calendaire (pas indéfiniment) —
 *    une prévision doit se traduire par une visite ce mois-ci, mais les
 *    comptes redeviennent disponibles le mois suivant.
 *  - Départements cibles de la semaine choisis par valeur totale de
 *    prévision, puis ORDONNÉS par temps de trajet croissant depuis Lyon sur
 *    les jours de la semaine — pour enchaîner les zones proches plutôt que
 *    de sauter d'un bout à l'autre de la région d'un jour à l'autre (ex:
 *    Clermont-Ferrand puis Grenoble).
 *  - Au moins une visite prospect par jour comportant une visite client,
 *    dans le même département si possible.
 *  - 1h d'appels (comptes à relancer, cf. getPhoneFollowUps) + 1h
 *    d'administratif/mails en fin de journée.
 * `existingEvents` sert uniquement à exclure les comptes déjà planifiés ce
 * mois-ci ; la régénération elle-même (suppression des anciennes lignes
 * 'auto' avant réinsertion) est gérée par l'appelant, pas ici.
 */
export function generateWeeklyPlan(
  weekStart: Date,
  accounts: Account[],
  forecasts: AccountForecast[],
  actions: { account_id: string; type: string; due_date: string | null; done: boolean }[],
  existingEvents: ExistingPlanningEvent[]
): DraftPlanningEvent[] {
  const monthKey = (y: number, m: number) => `${y}-${m}`;
  const thisMonthKey = monthKey(weekStart.getFullYear(), weekStart.getMonth() + 1);
  // Le mois suivant n'est inclus que si la semaine elle-même chevauche sur
  // ce mois suivant (dernière semaine du mois) — sinon les comptes prévus
  // pour le mois suivant sont "consommés" dès les premières semaines du
  // mois en cours et il ne reste plus rien à générer une fois ce mois arrivé.
  const weekEndFriday = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 4);
  const straddlesNextMonth = weekEndFriday.getMonth() !== weekStart.getMonth();
  const nextMonthDate = new Date(weekStart.getFullYear(), weekStart.getMonth() + 1, 1);
  const nextMonthKey = straddlesNextMonth ? monthKey(nextMonthDate.getFullYear(), nextMonthDate.getMonth() + 1) : null;

  // Un compte n'est "déjà pris" que s'il a une visite dans le même mois
  // calendaire que la semaine générée — sinon le pool se vide au bout de
  // 2-3 semaines et plus rien ne se génère ensuite.
  const monthStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
  const monthEnd = new Date(weekStart.getFullYear(), weekStart.getMonth() + 1, 1);
  const existingAccountIds = new Set(
    existingEvents
      .filter((e) => {
        if (!e.account_id) return false;
        const d = new Date(e.start_at);
        return d >= monthStart && d < monthEnd;
      })
      .map((e) => e.account_id as string)
  );

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

  const withForecast = Array.from(bestForecastByAccount.entries())
    .map(([accountId, forecast]) => ({ account: accountById.get(accountId), forecast }))
    .filter(
      (c): c is { account: Account; forecast: AccountForecast } =>
        !!c.account && !existingAccountIds.has(c.account.id)
    );

  // Comptes "à risque" (statut a_risque) : à défendre en priorité pour
  // préserver la relation, même sans commande imminente au prévisionnel.
  // S'ils n'ont pas de prévision ce mois-ci, on les ajoute quand même avec
  // une prévision nulle et une note de maintien de relation, plutôt que de
  // ne compter que sur le CA prévu pour décider qui mérite une visite.
  const forecastedIds = new Set(withForecast.map((c) => c.account.id));
  const atRiskExtra = accounts
    .filter((a) => a.status === "a_risque" && !existingAccountIds.has(a.id) && !forecastedIds.has(a.id))
    .map((a) => ({
      account: a,
      forecast: {
        ca_prevu: 0,
        boites_prevues: 0,
        commentaire: "Compte à risque — visite de maintien de relation",
        note: null,
      } as unknown as AccountForecast,
    }));

  const clientCandidates = [...withForecast, ...atRiskExtra].sort((a, b) => {
    const aRisk = a.account.status === "a_risque";
    const bRisk = b.account.status === "a_risque";
    if (aRisk !== bRisk) return aRisk ? -1 : 1; // les comptes à défendre passent en premier
    return (b.forecast.ca_prevu ?? 0) - (a.forecast.ca_prevu ?? 0);
  });

  const prospectCandidates = accounts
    .filter((a) => isProspect(a) && !existingAccountIds.has(a.id))
    .sort((a, b) => computeTargetingScore(b).total - computeTargetingScore(a).total);

  const followUps = getPhoneFollowUps(
    accounts.filter((a) => !existingAccountIds.has(a.id)),
    actions as never
  );

  // Départements cibles de la semaine : les mieux valorisés d'abord, puis
  // réordonnés par proximité croissante pour un enchaînement cohérent.
  const deptTotals = new Map<string, number>();
  for (const c of clientCandidates) {
    const d = c.account.department_code;
    if (!d) continue;
    // Un compte à défendre pèse un minimum forfaitaire même sans prévision
    // chiffrée, pour ne pas faire disparaître son département du classement.
    const weight = c.account.status === "a_risque" ? Math.max(500, c.forecast.ca_prevu ?? 0) : (c.forecast.ca_prevu ?? 0);
    deptTotals.set(d, (deptTotals.get(d) ?? 0) + weight);
  }
  const weekDepts = Array.from(deptTotals.entries())
    // Un département trop loin pour un aller-retour dans la journée n'est
    // jamais proposé en visite automatique — mieux vaut le laisser de côté
    // (l'utilisateur peut toujours le planifier manuellement s'il prévoit
    // une journée entière dédiée) que suggérer une route infaisable.
    .filter(([d]) => travelMinutesFor(d) <= MAX_TRAVEL_MINUTES)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([d]) => d)
    .sort((a, b) => travelMinutesFor(a) - travelMinutesFor(b));

  const events: DraftPlanningEvent[] = [];
  const usedClientIds = new Set<string>();
  const usedProspectIds = new Set<string>();

  for (let day = 0; day < 5; day++) {
    const dayDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + day);

    const targetDept = weekDepts[day] ?? null;
    const travelMin = travelMinutesFor(targetDept);

    // Plus de créneau appel/admin figé en fin de journée : ils démarrent
    // juste après les visites du jour (variable selon le nombre de visites),
    // avec une journée qui reste bornée à 19h au plus tard.
    const dayHardEnd = atHour(dayDate, JOUR_FIN_H + 1);
    const visiteSoftLimit = atHour(dayDate, JOUR_FIN_H - 1); // laisse au moins 2h pour appels+admin

    let cursor = addMin(atHour(dayDate, JOUR_DEBUT_H), travelMin);

    const dayClients = targetDept
      ? clientCandidates.filter((c) => !usedClientIds.has(c.account.id) && c.account.department_code === targetDept)
      : [];

    let placedClientToday = false;
    for (const c of dayClients) {
      const end = addMin(cursor, VISITE_MIN);
      if (end > visiteSoftLimit) break;
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
        if (end <= visiteSoftLimit) {
          events.push({
            account_id: prospect.id,
            type: "visite_prospect",
            title: prospect.name,
            note: "Prospection — nouveau compte à développer",
            start_at: cursor,
            end_at: end,
          });
          usedProspectIds.add(prospect.id);
          cursor = addMin(end, BUFFER_MIN);
        }
      }
    }

    // Journée sans visite : les appels démarrent en milieu de matinée plutôt
    // qu'à l'heure d'arrivée théorique (qui n'a pas de sens sans trajet réel).
    if (!placedClientToday) cursor = atHour(dayDate, 10);

    const appelStart = cursor;
    let appelEnd = addMin(appelStart, 60);
    let adminStart = addMin(appelEnd, BUFFER_MIN);
    let adminEnd = addMin(adminStart, 60);
    if (adminEnd > dayHardEnd) {
      // Journée déjà bien remplie : on raccourcit plutôt que déborder au-delà
      // d'une heure raisonnable.
      const overflow = (adminEnd.getTime() - dayHardEnd.getTime()) / 60000;
      adminEnd = new Date(adminEnd.getTime() - overflow * 60000);
      adminStart = new Date(adminStart.getTime() - Math.max(0, overflow - 30) * 60000);
      appelEnd = new Date(appelEnd.getTime() - Math.max(0, overflow - 60) * 60000);
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

/** Tous les lundis dont la semaine touche au moins un des mois donnés. */
export function mondaysCoveringMonths(monthsList: { year: number; month: number }[]): Date[] {
  const seen = new Set<number>();
  const mondays: Date[] = [];
  for (const { year, month } of monthsList) {
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    let d = mondayOf(first);
    while (d <= last) {
      const t = d.getTime();
      if (!seen.has(t)) {
        seen.add(t);
        mondays.push(new Date(d));
      }
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
    }
  }
  return mondays.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Génère le planning de plusieurs mois d'un coup (toutes les semaines qui
 * les couvrent), en propageant les comptes déjà planifiés d'une semaine sur
 * l'autre pour ne pas les reproposer — utilisé quand le prévisionnel
 * Pilotage vient d'être (re)généré, pour remplir l'agenda sans repasser
 * semaine par semaine dans /relances.
 */
export function generateMonthlyPlan(
  monthsList: { year: number; month: number }[],
  accounts: Account[],
  forecasts: AccountForecast[],
  actions: { account_id: string; type: string; due_date: string | null; done: boolean }[],
  existingEvents: ExistingPlanningEvent[]
): DraftPlanningEvent[] {
  const weeks = mondaysCoveringMonths(monthsList);
  let running = [...existingEvents];
  const allDrafts: DraftPlanningEvent[] = [];
  for (const monday of weeks) {
    const draft = generateWeeklyPlan(monday, accounts, forecasts, actions, running);
    allDrafts.push(...draft);
    running = [...running, ...draft.map((d) => ({ account_id: d.account_id, start_at: d.start_at.toISOString() }))];
  }
  return allDrafts;
}

export function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}
