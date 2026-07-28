"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { predictPortfolioForecast, suggestMonthlyForecast, allocateToHcps } from "@/lib/forecast";
import type { HcpLite } from "@/lib/forecast";
import { generateMonthlyPlan } from "@/lib/planning";
import { detectOpportunities, OPPORTUNITY_META } from "@/lib/opportunities";
import type { Opportunity } from "@/lib/opportunities";
import { computeTargetingScore, prixBoiteHT, ACTION_META } from "@/lib/scoring";
import { isProspect } from "@/lib/accounts";
import { computePersonaModels, personaRecommendations, PERSONAS } from "@/lib/persona";
import type { Persona } from "@/lib/persona";
import { SegmentBadge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { formatEUR, formatNumber, formatPct } from "@/lib/utils";
import type { Account, AccountForecast, Hcp, SectorObjective } from "@/types/database";
import { GripVertical, Trash2, Loader2, Target, Wand2, Stethoscope, FileDown } from "lucide-react";
import * as XLSX from "xlsx";

type HcpRow = Pick<Hcp, "id" | "account_id" | "name" | "potentiel_boites">;
type ProductRow = {
  account_id: string;
  brand: string;
  sales_value_ly: number | null;
  sales_value_cy: number | null;
  qty_ordered_cy: number | null;
};
type CardSort = "ca" | "boites" | "score" | "nom" | "silence";
const SEGMENTS = ["A", "B", "C", "D", "E"] as const;

const MONTH_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

interface MonthlySale {
  account_id: string;
  year: number;
  month: number;
  ca: number;
}

function nextMonths(count: number): { year: number; month: number }[] {
  const now = new Date();
  const result: { year: number; month: number }[] = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i < count; i++) {
    result.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return result;
}

export function PilotageBoard({
  accounts,
  initialForecasts,
  monthlySales,
  hcps,
  products,
  sectorObjectives,
}: {
  accounts: Account[];
  initialForecasts: AccountForecast[];
  monthlySales: MonthlySale[];
  hcps: HcpRow[];
  products: ProductRow[];
  sectorObjectives: SectorObjective[];
}) {
  const [forecasts, setForecasts] = useState(initialForecasts);
  const [isSaving, setIsSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [horizon, setHorizon] = useState<1 | 3 | 6 | 12>(3);
  const [cardSort, setCardSort] = useState<CardSort>("ca");

  const months = useMemo(() => nextMonths(horizon), [horizon]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const hcpsByAccount = useMemo(() => {
    const map = new Map<string, HcpLite[]>();
    for (const h of hcps) {
      if (!h.account_id) continue;
      const lite: HcpLite = { id: h.id, name: h.name, potentiel_boites: h.potentiel_boites };
      const arr = map.get(h.account_id);
      if (arr) arr.push(lite);
      else map.set(h.account_id, [lite]);
    }
    return map;
  }, [hcps]);

  // ── Mission par compte : une recommandation concrète à mener (référence à
  // proposer selon le modèle du persona, ou à défaut l'action du score), pour
  // que chaque médecin listé soit accompagné d'une action réelle plutôt que
  // d'un simple chiffre.
  const personaByAccount = useMemo(() => {
    const map = new Map<string, Persona>();
    for (const a of accounts) {
      if (a.persona && (PERSONAS as readonly string[]).includes(a.persona)) map.set(a.id, a.persona as Persona);
    }
    return map;
  }, [accounts]);
  const caByAccount = useMemo(() => new Map(accounts.map((a) => [a.id, a.ca_2026_ytd ?? 0] as const)), [accounts]);
  const brandsByAccount = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const p of products) {
      if ((p.qty_ordered_cy ?? 0) <= 0) continue;
      const set = map.get(p.account_id) ?? new Set<string>();
      set.add(p.brand);
      map.set(p.account_id, set);
    }
    return map;
  }, [products]);
  const personaModels = useMemo(
    () => computePersonaModels(personaByAccount, products, caByAccount),
    [personaByAccount, products, caByAccount]
  );
  const modelByPersona = useMemo(() => new Map(personaModels.map((m) => [m.persona, m] as const)), [personaModels]);

  function missionForAccount(account: Account): string {
    const persona = personaByAccount.get(account.id);
    if (persona) {
      const recos = personaRecommendations(modelByPersona.get(persona), brandsByAccount.get(account.id) ?? new Set(), 0.4, 1);
      if (recos.length > 0) {
        const qty = Math.round(recos[0].medianQty);
        return `Proposer ${recos[0].brand}${qty > 0 ? ` (~${qty} boîtes` : " (référence-clé"} des ${persona.toLowerCase()}s)`;
      }
    }
    return ACTION_META[computeTargetingScore(account).action].label;
  }

  const opportunities = useMemo(() => detectOpportunities(accounts), [accounts]);
  const opportunityByAccount = useMemo(
    () => new Map(opportunities.map((o) => [o.account.id, o] as const)),
    [opportunities]
  );

  const filteredOpportunities = useMemo(
    () =>
      opportunities.filter((o) =>
        filter ? o.account.name.toLowerCase().includes(filter.toLowerCase()) : true
      ),
    [opportunities, filter]
  );

  const cumulOpportunites = useMemo(
    () => filteredOpportunities.reduce((s, o) => s + o.value, 0),
    [filteredOpportunities]
  );

  const realiseByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of monthlySales) {
      const key = `${s.year}-${s.month}`;
      map.set(key, (map.get(key) ?? 0) + s.ca);
    }
    return map;
  }, [monthlySales]);

  // Réalisé par compte × mois — permet d'afficher, ligne par ligne, si un
  // compte prévu a effectivement commandé (visible dès le prochain import de
  // ventes, sans action manuelle).
  const realiseByAccountMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of monthlySales) {
      const key = `${s.account_id}-${s.year}-${s.month}`;
      map.set(key, (map.get(key) ?? 0) + s.ca);
    }
    return map;
  }, [monthlySales]);

  // Synthèse de planification sur la période affichée (mois / trimestre /
  // semestre selon l'horizon) : combien on planifie, chez qui, prospects,
  // répartition Premium/Pro/Pro+, et le réalisé de la même période.
  const periodSummary = useMemo(() => {
    const keySet = new Set(months.map((m) => `${m.year}-${m.month}`));
    const rows = forecasts.filter((f) => keySet.has(`${f.year}-${f.month}`));
    const totalCa = rows.reduce((s, f) => s + (f.ca_prevu ?? 0), 0);
    const totalBoites = rows.reduce((s, f) => s + (f.boites_prevues ?? 0), 0);
    const accountIds = new Set(rows.map((r) => r.account_id));
    const tiers: Record<"Premium" | "Pro" | "Pro+", number> = { Premium: 0, Pro: 0, "Pro+": 0 };
    let prospects = 0;
    for (const id of accountIds) {
      const acc = accountById.get(id);
      if (!acc) continue;
      if (isProspect(acc)) prospects++;
      if (acc.price_list === "Premium" || acc.price_list === "Pro" || acc.price_list === "Pro+") {
        tiers[acc.price_list]++;
      }
    }
    const realise = months.reduce((s, m) => s + (realiseByMonth.get(`${m.year}-${m.month}`) ?? 0), 0);
    const objectif = months.reduce((s, m) => {
      const o = sectorObjectives.find((x) => x.year === m.year && x.month === m.month);
      return s + (o?.objectif_ca ?? 0);
    }, 0);
    return { totalCa, totalBoites, comptes: accountIds.size, prospects, tiers, realise, objectif };
  }, [forecasts, months, accountById, realiseByMonth, sectorObjectives]);

  const periodLabel = horizon === 1 ? "ce mois" : horizon === 3 ? "ce trimestre" : horizon === 6 ? "ce semestre" : "cette année";

  const accountSegment = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.segment] as const)),
    [accounts]
  );

  // CA par segment SUR LA PÉRIODE affichée : prévu (prévisionnel) vs réalisé.
  const caParSegment = useMemo(() => {
    const keySet = new Set(months.map((m) => `${m.year}-${m.month}`));
    const prevu: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    const realise: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const f of forecasts) {
      if (!keySet.has(`${f.year}-${f.month}`)) continue;
      const seg = accountSegment.get(f.account_id);
      if (seg && seg in prevu) prevu[seg] += f.ca_prevu ?? 0;
    }
    for (const s of monthlySales) {
      if (!keySet.has(`${s.year}-${s.month}`)) continue;
      const seg = accountSegment.get(s.account_id);
      if (seg && seg in realise) realise[seg] += s.ca;
    }
    return { prevu, realise };
  }, [forecasts, monthlySales, months, accountSegment]);
  const caSegmentMax = Math.max(...SEGMENTS.flatMap((s) => [caParSegment.prevu[s], caParSegment.realise[s]]), 1);

  // Références vendues 2025 vs 2026 (annuel) — pour voir quoi pousser en priorité.
  const refsByYear = useMemo(() => {
    const m = new Map<string, { y2025: number; y2026: number }>();
    for (const p of products) {
      const cur = m.get(p.brand) ?? { y2025: 0, y2026: 0 };
      cur.y2025 += p.sales_value_ly ?? 0;
      cur.y2026 += p.sales_value_cy ?? 0;
      m.set(p.brand, cur);
    }
    return Array.from(m.entries())
      .map(([brand, v]) => ({ brand, ...v }))
      .filter((r) => r.y2025 > 0 || r.y2026 > 0)
      .sort((a, b) => b.y2025 + b.y2026 - (a.y2025 + a.y2026))
      .slice(0, 8);
  }, [products]);
  const refsMax = Math.max(...refsByYear.flatMap((r) => [r.y2025, r.y2026]), 1);

  const periodRange =
    months.length > 0
      ? `${MONTH_LABELS[months[0].month - 1].slice(0, 3)} ${months[0].year} → ${MONTH_LABELS[months[months.length - 1].month - 1].slice(0, 3)} ${months[months.length - 1].year}`
      : "";

  // Couverture du portefeuille : comptes planifiés vs total, prospects.
  const totalProspects = useMemo(() => accounts.filter(isProspect).length, [accounts]);
  const couverture = accounts.length > 0 ? periodSummary.comptes / accounts.length : 0;
  const atteinteRealise = periodSummary.totalCa > 0 ? periodSummary.realise / periodSummary.totalCa : 0;
  const atteinteObjectif = periodSummary.objectif > 0 ? periodSummary.realise / periodSummary.objectif : 0;

  // Suivi Premium / Pro / Pro+ : boîtes à faire (objectif) vs réalisées.
  const tierTracking = useMemo(() => {
    return (["Premium", "Pro", "Pro+"] as const).map((tier) => {
      const list = accounts.filter((a) => a.price_list === tier);
      const objectifBoites = list.reduce((s, a) => s + (a.objectif_boites ?? 0), 0);
      const realiseBoites = list.reduce(
        (s, a) => s + (a.realise_boites ?? (a.ca_2026_ytd ? a.ca_2026_ytd / prixBoiteHT(tier) : 0)),
        0
      );
      return { tier, count: list.length, objectifBoites, realiseBoites };
    });
  }, [accounts]);

  // Prévu vs Réalisé mois par mois (année en cours) — courbe d'atterrissage.
  const currentYear = new Date().getFullYear();
  const landing = useMemo(() => {
    const prevu = new Array(12).fill(0) as number[];
    const realise = new Array(12).fill(0) as number[];
    for (const f of forecasts) if (f.year === currentYear) prevu[f.month - 1] += f.ca_prevu ?? 0;
    for (const s of monthlySales) if (s.year === currentYear) realise[s.month - 1] += s.ca;
    return { prevu, realise };
  }, [forecasts, monthlySales, currentYear]);
  const landingMax = Math.max(...landing.prevu, ...landing.realise, 1);

  // Récurrence des commandes : écart moyen (mois) entre 2 commandes par compte.
  const recurrence = useMemo(() => {
    const byAcc = new Map<string, number[]>();
    for (const s of monthlySales) {
      if (s.ca <= 0) continue;
      const idx = s.year * 12 + s.month;
      const arr = byAcc.get(s.account_id);
      if (arr) arr.push(idx);
      else byAcc.set(s.account_id, [idx]);
    }
    const buckets = { Mensuelle: 0, Bimestrielle: 0, Trimestrielle: 0, Espacée: 0, Unique: 0 };
    for (const months of byAcc.values()) {
      if (months.length < 2) {
        buckets.Unique++;
        continue;
      }
      months.sort((a, b) => a - b);
      let gap = 0;
      for (let i = 1; i < months.length; i++) gap += months[i] - months[i - 1];
      const avg = gap / (months.length - 1);
      if (avg <= 1.3) buckets.Mensuelle++;
      else if (avg <= 2.5) buckets.Bimestrielle++;
      else if (avg <= 4) buckets.Trimestrielle++;
      else buckets.Espacée++;
    }
    return buckets;
  }, [monthlySales]);
  const recurrenceTotal = Object.values(recurrence).reduce((s, v) => s + v, 0) || 1;

  // Comptes ayant réellement commandé ce mois-ci mais absents du prévisionnel
  // (jamais prédits, ou prédits sur un autre mois) — sans ça, une commande
  // "surprise" reste invisible dans le tableau, noyée dans le seul total
  // "Réalisé" agrégé de la colonne.
  function unforecastedOrdersFor(year: number, month: number) {
    const forecastedAccountIds = new Set(forecastsFor(year, month).map((f) => f.account_id));
    return monthlySales
      .filter((s) => s.year === year && s.month === month && s.ca > 0 && !forecastedAccountIds.has(s.account_id))
      .map((s) => ({ account_id: s.account_id, ca: s.ca }))
      .sort((a, b) => b.ca - a.ca);
  }

  function forecastsFor(year: number, month: number) {
    const rows = forecasts.filter((f) => f.year === year && f.month === month);
    return rows.sort((a, b) => {
      // Une commande réellement passée ce mois-ci reste toujours épinglée en
      // haut de la colonne, prévision et commentaire compris — c'est le signal
      // le plus important du mois, pas une ligne parmi d'autres.
      const realiseA = realiseByAccountMonth.get(`${a.account_id}-${year}-${month}`) ?? 0;
      const realiseB = realiseByAccountMonth.get(`${b.account_id}-${year}-${month}`) ?? 0;
      if ((realiseA > 0) !== (realiseB > 0)) return realiseA > 0 ? -1 : 1;
      const accA = accountById.get(a.account_id);
      const accB = accountById.get(b.account_id);
      switch (cardSort) {
        case "boites":
          return (b.boites_prevues ?? 0) - (a.boites_prevues ?? 0);
        case "nom":
          return (accA?.name ?? "").localeCompare(accB?.name ?? "");
        case "score":
          return (accB ? computeTargetingScore(accB).total : 0) - (accA ? computeTargetingScore(accA).total : 0);
        case "silence":
          return (accB?.jours_silence ?? 0) - (accA?.jours_silence ?? 0);
        case "ca":
        default:
          return (b.ca_prevu ?? 0) - (a.ca_prevu ?? 0);
      }
    });
  }

  async function handleDrop(accountId: string, year: number, month: number) {
    setDropTarget(null);
    setDragging(null);
    const account = accountById.get(accountId);
    if (!account) return;
    if (forecasts.some((f) => f.account_id === accountId && f.year === year && f.month === month)) return;

    const [suggestion] = suggestMonthlyForecast(account, [{ year, month }]);
    const opp = opportunityByAccount.get(accountId);
    const note = opp ? `${opp.label} — ${opp.reason}` : suggestion.note;

    setIsSaving(true);
    const supabase = createClient();
    // Action explicite de l'utilisateur (glisser-déposer) : marquée "manuel",
    // ne sera jamais recalculée par le générateur portefeuille.
    const { data, error } = await supabase
      .from("account_forecasts")
      .insert({
        account_id: accountId,
        year,
        month,
        boites_prevues: suggestion.boites_prevues,
        ca_prevu: suggestion.ca_prevu,
        note,
        source: "manuel" as const,
      })
      .select()
      .single();
    setIsSaving(false);
    if (!error && data) setForecasts((prev) => [...prev, data as AccountForecast]);
  }

  async function moveForecast(forecastId: string, year: number, month: number) {
    setDropTarget(null);
    setDragging(null);
    const existing = forecasts.find((f) => f.id === forecastId);
    if (!existing) return;
    if (existing.year === year && existing.month === month) return;
    // Déjà une ligne sur le mois cible pour ce compte : on ne fusionne pas
    // silencieusement, mieux vaut que l'utilisateur les traite à la main.
    if (forecasts.some((f) => f.account_id === existing.account_id && f.year === year && f.month === month)) return;

    setIsSaving(true);
    // Déplacer un compte d'un mois à l'autre est une décision manuelle
    // explicite : la ligne est marquée "manuel", elle ne sera jamais
    // réécrite par le générateur portefeuille.
    setForecasts((prev) => prev.map((f) => (f.id === forecastId ? { ...f, year, month, source: "manuel" } : f)));
    const supabase = createClient();
    await supabase.from("account_forecasts").update({ year, month, source: "manuel" as const }).eq("id", forecastId);
    setIsSaving(false);
  }

  const [autoFilling, setAutoFilling] = useState(false);

  async function autoFillPortfolio() {
    setAutoFilling(true);
    const existingEntries = forecasts
      .filter((f) => f.kind === "prevision")
      .map((f) => ({
        account_id: f.account_id,
        year: f.year,
        month: f.month,
        boites_prevues: f.boites_prevues,
        source: f.source,
      }));
    const predictions = predictPortfolioForecast(accounts, hcpsByAccount, monthlySales, existingEntries, months);
    const supabase = createClient();

    // Un mois que le modèle jugeait éligible lors d'une génération précédente
    // peut ne plus l'être (compte désormais trop proche d'une commande déjà
    // prévue, espacement minimum non respecté, etc.) — sans nettoyage, cette
    // ancienne ligne 'auto' reste affichée à côté de la nouvelle et double le
    // compte pour ce mois-là. On supprime donc les lignes 'auto' du mois
    // ciblé qui ne font plus partie du résultat avant d'écrire les nouvelles.
    const keyOf = (f: { account_id: string; year: number; month: number }) => `${f.account_id}-${f.year}-${f.month}`;
    const predictedKeys = new Set(predictions.map(keyOf));
    const monthKeySet = new Set(months.map((m) => `${m.year}-${m.month}`));
    const staleIds = forecasts
      .filter(
        (f) =>
          f.kind === "prevision" &&
          f.source === "auto" &&
          !f.commentaire &&
          monthKeySet.has(`${f.year}-${f.month}`) &&
          !predictedKeys.has(keyOf(f))
      )
      .map((f) => f.id);
    if (staleIds.length > 0) {
      await supabase.from("account_forecasts").delete().in("id", staleIds);
      setForecasts((prev) => prev.filter((f) => !staleIds.includes(f.id)));
    }

    if (predictions.length === 0) {
      setAutoFilling(false);
      return;
    }
    // upsert sur (account_id, year, month, kind) : crée les mois manquants et
    // actualise ceux déjà générés par l'IA (source='auto') — jamais les mois
    // saisis à la main, exclus en amont par predictMonthlyForecast.
    // La répartition par médecin est calculée pour l'affichage, pas stockée :
    // seuls le CA et les boîtes au niveau compte partent en base.
    const { data, error } = await supabase
      .from("account_forecasts")
      .upsert(
        predictions.map((p) => {
          const account = accountById.get(p.account_id);
          const mission = account ? missionForAccount(account) : "";
          return {
            account_id: p.account_id,
            year: p.year,
            month: p.month,
            boites_prevues: p.boites_prevues,
            ca_prevu: p.ca_prevu,
            note: mission ? `${p.note} · ${mission}` : p.note,
            kind: "prevision" as const,
            source: "auto" as const,
          };
        }),
        { onConflict: "account_id,year,month,kind" }
      )
      .select();
    if (!error && data) {
      const written = data as AccountForecast[];
      const keyOf = (f: { account_id: string; year: number; month: number }) => `${f.account_id}-${f.year}-${f.month}`;
      const writtenKeys = new Set(written.map(keyOf));
      setForecasts((prev) => [...prev.filter((f) => f.kind !== "prevision" || !writtenKeys.has(keyOf(f))), ...written]);

      // Le prévisionnel vient d'être (ré)généré : remplit aussitôt l'agenda
      // (/relances) sur les mêmes mois, pour ne pas avoir à repasser
      // semaine par semaine générer le planning à la main.
      await generatePlanningForMonths(written);
    }
    setAutoFilling(false);
  }

  async function generatePlanningForMonths(forecastsJustWritten: AccountForecast[]) {
    const monthsList = Array.from(new Set(months.map((m) => `${m.year}-${m.month}`))).map((k) => {
      const [y, mo] = k.split("-").map(Number);
      return { year: y, month: mo };
    });
    if (monthsList.length === 0) return;

    const supabase = createClient();
    const [{ data: actionsRaw }, { data: eventsRaw }] = await Promise.all([
      supabase.from("account_actions").select("account_id, type, due_date, done"),
      supabase.from("planning_events").select("id, account_id, start_at, source"),
    ]);

    const manuelForecasts = forecasts.filter((f) => f.kind === "prevision" && f.source === "manuel");
    const forecastsForPlanning = [...manuelForecasts, ...forecastsJustWritten];

    const range = monthsList.reduce(
      (acc, m) => {
        const start = new Date(m.year, m.month - 1, 1);
        const end = new Date(m.year, m.month, 1);
        return { min: acc.min && acc.min < start ? acc.min : start, max: acc.max && acc.max > end ? acc.max : end };
      },
      { min: null as Date | null, max: null as Date | null }
    );

    const existingEvents = (eventsRaw ?? []) as { id: string; account_id: string | null; start_at: string; source: string }[];
    const draft = generateMonthlyPlan(
      monthsList,
      accounts,
      forecastsForPlanning,
      (actionsRaw ?? []) as { account_id: string; type: string; due_date: string | null; done: boolean }[],
      existingEvents.map((e) => ({ account_id: e.account_id, start_at: e.start_at }))
    );

    // Idempotent, comme pour le prévisionnel : supprime les lignes 'auto'
    // déjà présentes sur la période couverte avant de réinsérer.
    const staleEventIds = existingEvents
      .filter(
        (e) =>
          e.source === "auto" &&
          range.min &&
          range.max &&
          new Date(e.start_at) >= range.min &&
          new Date(e.start_at) < range.max
      )
      .map((e) => e.id);
    if (staleEventIds.length > 0) {
      await supabase.from("planning_events").delete().in("id", staleEventIds);
    }
    if (draft.length > 0) {
      await supabase.from("planning_events").insert(
        draft.map((d) => ({
          account_id: d.account_id,
          type: d.type,
          title: d.title,
          note: d.note,
          start_at: d.start_at.toISOString(),
          end_at: d.end_at.toISOString(),
          source: "auto" as const,
        }))
      );
    }
  }

  async function removeForecast(id: string) {
    setForecasts((prev) => prev.filter((f) => f.id !== id));
    const supabase = createClient();
    await supabase.from("account_forecasts").delete().eq("id", id);
  }

  async function updateForecastCa(id: string, ca_prevu: number) {
    // Une modification manuelle doit être marquée "manuel" : sinon la ligne
    // reste taguée "auto" et le prochain "Générer" l'écrase silencieusement.
    setForecasts((prev) => prev.map((f) => (f.id === id ? { ...f, ca_prevu, source: "manuel" } : f)));
    const supabase = createClient();
    await supabase.from("account_forecasts").update({ ca_prevu, source: "manuel" as const }).eq("id", id);
  }

  async function updateForecastCommentaire(id: string, commentaire: string) {
    // Champ libre distinct de la note générée par le modèle : jamais réécrit
    // par le générateur, donc jamais perdu au clic sur "Générer".
    setForecasts((prev) => prev.map((f) => (f.id === id ? { ...f, commentaire } : f)));
    const supabase = createClient();
    await supabase.from("account_forecasts").update({ commentaire }).eq("id", id);
  }

  async function createForecastComment(accountId: string, year: number, month: number, commentaire: string) {
    // Un compte qui a commandé sans avoir été prévu n'a pas de ligne en base
    // pour porter le commentaire — on en crée une (0 boîte/0 €, manuelle),
    // qui rejoint alors le tableau normal des prévisions et remonte en haut
    // grâce au tri "réalisé ce mois-ci en premier".
    const supabase = createClient();
    const { data, error } = await supabase
      .from("account_forecasts")
      .insert({
        account_id: accountId,
        year,
        month,
        kind: "prevision" as const,
        boites_prevues: 0,
        ca_prevu: 0,
        commentaire,
        source: "manuel" as const,
      })
      .select()
      .single();
    if (!error && data) setForecasts((prev) => [...prev, data as AccountForecast]);
  }

  function exportToExcel() {
    const rows = months.flatMap(({ year, month }) =>
      forecastsFor(year, month).map((f) => {
        const account = accountById.get(f.account_id);
        const accHcps = hcpsByAccount.get(f.account_id) ?? [];
        const allocation = allocateToHcps(accHcps, f.boites_prevues ?? 0, f.ca_prevu ?? 0);
        return {
          Mois: `${MONTH_LABELS[month - 1]} ${year}`,
          Compte: account?.name ?? "—",
          Segment: account?.segment ?? "",
          Score: account ? computeTargetingScore(account).total : "",
          "Boîtes prévues": f.boites_prevues ?? 0,
          "CA prévu (€)": f.ca_prevu ?? 0,
          "CA réalisé (€)": realiseByAccountMonth.get(`${f.account_id}-${year}-${month}`) ?? 0,
          Mission: account ? missionForAccount(account) : "",
          "Médecins (répartition)": allocation.map((h) => `${h.name} (${h.boites} b · ${Math.round(h.ca)} €)`).join(" ; "),
          Note: f.note ?? "",
        };
      })
    );

    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 14 }, { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 35 }, { wch: 50 }, { wch: 40 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Prévisionnel");
    const label = horizon === 1 ? "mois" : horizon === 3 ? "trimestre" : horizon === 6 ? "semestre" : "annee";
    XLSX.writeFile(workbook, `previsionnel-pilotage-${label}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="space-y-4">
      {/* ── Encart de planification (adapté à la période) ─────────── */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Planification — {periodLabel} <span className="ml-1 text-xs font-normal text-muted-foreground">({periodRange})</span>
          </h3>
          <span className="text-xs text-muted-foreground">
            Horizon : {horizon === 1 ? "1 mois" : horizon === 3 ? "trimestre" : horizon === 6 ? "semestre" : "année"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryTile label="CA planifié" value={formatEUR(periodSummary.totalCa)} accent />
          <SummaryTile label="Boîtes planifiées" value={formatNumber(periodSummary.totalBoites)} />
          <SummaryTile label="Comptes planifiés" value={formatNumber(periodSummary.comptes)} />
          <SummaryTile label="Dont prospects" value={formatNumber(periodSummary.prospects)} />
          <SummaryTile
            label="Premium / Pro / Pro+"
            value={`${periodSummary.tiers.Premium} / ${periodSummary.tiers.Pro} / ${periodSummary.tiers["Pro+"]}`}
          />
          <SummaryTile label="Réalisé (période)" value={formatEUR(periodSummary.realise)} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Jauges prévu / objectif / couverture */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avancement — {periodLabel}</p>
            <Gauge label="Réalisé vs prévu" value={atteinteRealise} left={formatEUR(periodSummary.realise)} right={formatEUR(periodSummary.totalCa)} />
            {periodSummary.objectif > 0 && (
              <Gauge label="Réalisé vs objectif" value={atteinteObjectif} left={formatEUR(periodSummary.realise)} right={formatEUR(periodSummary.objectif)} />
            )}
            <Gauge label="Couverture (comptes planifiés)" value={couverture} left={`${periodSummary.comptes}`} right={`${accounts.length}`} />
            <p className="mt-2 text-[11px] text-muted-foreground">
              {totalProspects} prospect(s) au total (sans commande &gt; 12 mois)
            </p>
          </div>

          {/* CA par segment — période, prévu vs réalisé */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">CA par segment — {periodLabel}</p>
            <div className="space-y-2">
              {SEGMENTS.map((s) => (
                <div key={s} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">Segment {s}</span>
                    <span className="text-muted-foreground">
                      Réal {formatEUR(caParSegment.realise[s])} · Prév {formatEUR(caParSegment.prevu[s])}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-surface-muted">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(caParSegment.realise[s] / caSegmentMax) * 100}%` }} />
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-surface-muted">
                    <div className="h-1.5 rounded-full bg-slate-300" style={{ width: `${(caParSegment.prevu[s] / caSegmentMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> Réalisé</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300" /> Prévu</span>
            </div>
          </div>

          {/* Références vendues 2025 vs 2026 */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Références vendues 2025 / 2026</p>
            {refsByYear.length === 0 ? (
              <p className="text-xs text-muted-foreground">Importez les données produit pour activer cette vue.</p>
            ) : (
              <div className="space-y-2">
                {refsByYear.map((r) => (
                  <div key={r.brand} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{r.brand}</span>
                      <span className="text-muted-foreground">{formatEUR(r.y2025)} → {formatEUR(r.y2026)}</span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-surface-muted">
                      <div className="h-1.5 rounded-full bg-amber-300" style={{ width: `${(r.y2025 / refsMax) * 100}%` }} />
                    </div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-surface-muted">
                      <div className="h-1.5 rounded-full bg-amber-500" style={{ width: `${(r.y2026 / refsMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-300" /> 2025</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-500" /> 2026</span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Suivi Premium / Pro / Pro+ — boîtes à faire vs réalisées */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Suivi Premium / Pro / Pro+ (boîtes)
            </p>
            {tierTracking.every((t) => t.count === 0) ? (
              <p className="text-xs text-muted-foreground">Aucun compte sous contrat — renseignez la colonne Account Partners.</p>
            ) : (
              <div className="space-y-2.5">
                {tierTracking.map((t) => (
                  <Link key={t.tier} href={`/comptes?tier=${encodeURIComponent(t.tier)}`} className="block rounded hover:bg-surface-muted">
                    <Gauge
                      label={`${t.tier} (${t.count}) →`}
                      value={t.objectifBoites > 0 ? t.realiseBoites / t.objectifBoites : 0}
                      left={`${formatNumber(Math.round(t.realiseBoites))} faites`}
                      right={`/ ${formatNumber(t.objectifBoites)} à faire`}
                    />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Récurrence des commandes */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Récurrence des commandes
            </p>
            <div className="space-y-2">
              {(["Mensuelle", "Bimestrielle", "Trimestrielle", "Espacée", "Unique"] as const).map((k) => (
                <Link key={k} href={`/comptes?recurrence=${encodeURIComponent(k)}`} className="block rounded hover:bg-surface-muted">
                  <div className="mb-0.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{k} →</span>
                    <span className="text-muted-foreground">{recurrence[k]} compte(s)</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-muted">
                    <div
                      className="h-1.5 rounded-full bg-indigo-400"
                      style={{ width: `${(recurrence[k] / recurrenceTotal) * 100}%` }}
                    />
                  </div>
                </Link>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">Écart moyen entre 2 commandes, sur l&apos;historique importé.</p>
          </div>
        </div>

        {/* Prévu vs Réalisé mois par mois — courbe d'atterrissage */}
        <div className="mt-4 rounded-lg border border-border p-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Prévu vs Réalisé mois par mois — {currentYear}
          </p>
          <div className="flex items-end gap-2" style={{ height: 130 }}>
            {landing.prevu.map((prevu, i) => {
              const realise = landing.realise[i];
              return (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-[100px] w-full items-end justify-center gap-0.5">
                    <div
                      className="w-1/2 rounded-t bg-slate-300"
                      style={{ height: `${Math.max((prevu / landingMax) * 100, prevu > 0 ? 3 : 0)}px` }}
                      title={`Prévu : ${formatEUR(prevu)}`}
                    />
                    <div
                      className="w-1/2 rounded-t bg-primary"
                      style={{ height: `${Math.max((realise / landingMax) * 100, realise > 0 ? 3 : 0)}px` }}
                      title={`Réalisé : ${formatEUR(realise)}`}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{MONTH_LABELS[i].slice(0, 3)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300" /> Prévu</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> Réalisé</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
      {/* ── Rail opportunités ─────────────────────────────────────── */}
      <div className="flex max-h-[calc(100vh-180px)] flex-col rounded-xl border border-border bg-surface">
        <div className="border-b border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Opportunités détectées</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Glissez un compte vers un mois pour planifier l&apos;action
          </p>
          <div className="mt-3 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-700">Cumul opportunités</p>
            <p className="text-lg font-semibold text-primary-700">{formatEUR(cumulOpportunites)}</p>
            <p className="text-[10px] text-primary-700/70">{filteredOpportunities.length} compte(s) en jeu</p>
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer..."
            className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {filteredOpportunities.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aucune opportunité détectée — importez vos fichiers pour alimenter l&apos;analyse.
            </p>
          )}
          {filteredOpportunities.slice(0, 40).map((opp) => (
            <OpportunityCard
              key={opp.account.id}
              opportunity={opp}
              months={months}
              isDragging={dragging === opp.account.id}
              onDragStart={() => setDragging(opp.account.id)}
              onDragEnd={() => { setDragging(null); setDropTarget(null); }}
              onPlan={(year, month) => handleDrop(opp.account.id, year, month)}
            />
          ))}
        </div>
      </div>

      {/* ── Colonnes mois ─────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-end gap-2">
          <button
            onClick={autoFillPortfolio}
            disabled={autoFilling}
            title="Remplit automatiquement le prévisionnel de tout le portefeuille sur la période affichée, à partir de la saisonnalité des commandes passées (ou du score/silence à défaut d'historique) — n'écrase jamais un mois déjà renseigné"
            className="mr-auto flex items-center gap-1.5 rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-60"
          >
            {autoFilling ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            Générer le prévisionnel du portefeuille
          </button>
          <button
            onClick={exportToExcel}
            title="Exporte le prévisionnel affiché (période et tri en cours) au format Excel"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
          >
            <FileDown size={13} />
            Exporter Excel
          </button>
          <span className="text-xs text-muted-foreground">Trier les comptes :</span>
          <select
            value={cardSort}
            onChange={(e) => setCardSort(e.target.value as CardSort)}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-primary"
          >
            <option value="ca">CA prévu</option>
            <option value="boites">Boîtes prévues</option>
            <option value="score">Score</option>
            <option value="silence">Silence</option>
            <option value="nom">Nom</option>
          </select>
          <span className="text-xs text-muted-foreground">Horizon :</span>
          {([1, 3, 6, 12] as const).map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                horizon === h
                  ? "border-primary bg-primary-50 text-primary-700"
                  : "border-border text-muted-foreground hover:bg-surface-muted"
              }`}
            >
              {h === 1 ? "1 mois" : h === 3 ? "Trimestre (3 mois)" : h === 6 ? "Semestre (6 mois)" : "Année (12 mois)"}
            </button>
          ))}
        </div>
        <div
          className={`grid grid-cols-1 gap-3 ${
            horizon === 1
              ? ""
              : horizon === 3
              ? "sm:grid-cols-2 xl:grid-cols-3"
              : horizon === 6
              ? "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
              : "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          }`}
        >
        {months.map(({ year, month }) => {
          const monthForecasts = forecastsFor(year, month);
          const totalPrevu = monthForecasts.reduce((s, f) => s + (f.ca_prevu ?? 0), 0);
          const realise = realiseByMonth.get(`${year}-${month}`) ?? 0;
          const objectifMonth = sectorObjectives.find((o) => o.year === year && o.month === month)?.objectif_ca ?? 0;
          const atteinte = totalPrevu > 0 ? Math.min(realise / totalPrevu, 1) : 0;
          const atteinteObjectifMonth = objectifMonth > 0 ? Math.min(realise / objectifMonth, 1) : 0;
          const key = `${year}-${month}`;
          const isTarget = dropTarget === key;

          return (
            <div
              key={key}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(key); }}
              onDragLeave={() => setDropTarget((t) => (t === key ? null : t))}
              onDrop={(e) => {
                e.preventDefault();
                const forecastId = e.dataTransfer.getData("text/forecast-id");
                if (forecastId) {
                  moveForecast(forecastId, year, month);
                  return;
                }
                const accountId = e.dataTransfer.getData("text/account-id");
                if (accountId) handleDrop(accountId, year, month);
              }}
              className={`flex min-h-[420px] flex-col rounded-xl border bg-surface transition-colors ${
                isTarget ? "border-primary bg-primary-50/50" : "border-border"
              }`}
            >
              <div className="border-b border-border p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground">
                    {MONTH_LABELS[month - 1]} <span className="text-muted-foreground">{year}</span>
                  </h4>
                  {isSaving && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
                </div>
                {objectifMonth > 0 && (
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Objectif</span>
                    <span className="font-medium text-foreground">{formatEUR(objectifMonth)}</span>
                  </div>
                )}
                <div className={`${objectifMonth > 0 ? "mt-1" : "mt-2"} flex items-center justify-between text-xs`}>
                  <span className="text-muted-foreground">Prévu</span>
                  <span className={`font-medium ${objectifMonth > 0 && totalPrevu < objectifMonth ? "text-danger" : "text-foreground"}`}>
                    {formatEUR(totalPrevu)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Réalisé</span>
                  <span className={`font-medium ${realise >= totalPrevu && totalPrevu > 0 ? "text-success" : "text-foreground"}`}>
                    {formatEUR(realise)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-surface-muted">
                  <div
                    className={`h-1.5 rounded-full ${
                      objectifMonth > 0 ? (atteinteObjectifMonth >= 1 ? "bg-success" : "bg-primary") : atteinte >= 1 ? "bg-success" : "bg-primary"
                    }`}
                    style={{ width: `${(objectifMonth > 0 ? atteinteObjectifMonth : atteinte) * 100}%` }}
                  />
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-2">
                {monthForecasts.length === 0 && unforecastedOrdersFor(year, month).length === 0 && (
                  <div className="flex h-full min-h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                    Déposez un compte ici
                  </div>
                )}
                {unforecastedOrdersFor(year, month).map((o) => {
                  const account = accountById.get(o.account_id);
                  if (!account) return null;
                  return (
                    <div key={`unforecasted-${o.account_id}`} className="rounded-lg border border-success/40 bg-success/5 p-2.5">
                      <Link
                        href={`/comptes/${account.id}`}
                        className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary"
                      >
                        {account.name}
                        <ScoreBadge score={computeTargetingScore(account).total} />
                      </Link>
                      <div className="mt-1 flex items-center justify-between text-[10px] font-medium text-success">
                        <span>Réalisé</span>
                        <span>✓ {formatEUR(o.ca)} commandé</span>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground/70">Commande non prévue ce mois-ci</p>
                      <input
                        type="text"
                        placeholder="Commentaire — quoi proposer..."
                        onBlur={(e) => {
                          if (e.target.value.trim()) createForecastComment(account.id, year, month, e.target.value);
                        }}
                        className="mt-1 w-full rounded border border-dashed border-border bg-transparent px-1.5 py-1 text-[10px] text-foreground placeholder:text-muted-foreground/60 hover:border-primary/50 focus:border-primary focus:outline-none"
                      />
                    </div>
                  );
                })}
                {monthForecasts.map((f) => {
                  const account = accountById.get(f.account_id);
                  if (!account) return null;
                  const accHcps = hcpsByAccount.get(account.id) ?? [];
                  const allocation = allocateToHcps(accHcps, f.boites_prevues ?? 0, f.ca_prevu ?? 0)
                    .filter((h) => h.ca > 0)
                    .sort((a, b) => b.ca - a.ca);
                  const realiseLigne = realiseByAccountMonth.get(`${account.id}-${year}-${month}`) ?? 0;
                  const commande = realiseLigne > 0;
                  return (
                    <div
                      key={f.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/forecast-id", f.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(f.id);
                      }}
                      onDragEnd={() => { setDragging(null); setDropTarget(null); }}
                      className={`cursor-grab rounded-lg border p-2.5 transition-opacity active:cursor-grabbing ${
                        commande ? "border-success/40 bg-success/5" : "border-border bg-surface-muted"
                      } ${dragging === f.id ? "opacity-40" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <Link
                          href={`/comptes/${account.id}`}
                          className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary"
                        >
                          {account.name}
                          <ScoreBadge score={computeTargetingScore(account).total} />
                        </Link>
                        <button
                          onClick={() => removeForecast(f.id)}
                          className="shrink-0 text-muted-foreground hover:text-danger"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {months.length > 1 && (
                        <div className="mt-1 flex items-center gap-1">
                          <select
                            defaultValue={`${year}-${month}`}
                            className="flex-1 rounded border border-border bg-surface px-1 py-0.5 text-[10px] outline-none focus:border-primary"
                          >
                            {months.map((m) => (
                              <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                                {MONTH_LABELS[m.month - 1]} {m.year}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={(e) => {
                              const select = e.currentTarget.previousElementSibling as HTMLSelectElement;
                              const [y, m] = select.value.split("-").map(Number);
                              moveForecast(f.id, y, m);
                            }}
                            className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-primary-50 hover:text-primary-700"
                          >
                            Déplacer
                          </button>
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <Target size={11} />
                        {formatNumber(f.boites_prevues)} boîtes ·
                        <input
                          type="number"
                          defaultValue={f.ca_prevu ?? 0}
                          onBlur={(e) => updateForecastCa(f.id, Number(e.target.value))}
                          className="w-20 rounded border border-transparent bg-transparent px-1 text-right hover:border-border focus:border-primary focus:outline-none"
                        />
                        €
                      </div>
                      <div
                        className={`mt-1 flex items-center justify-between text-[10px] font-medium ${
                          commande ? "text-success" : "text-muted-foreground/70"
                        }`}
                      >
                        <span>Réalisé</span>
                        <span>{commande ? `✓ ${formatEUR(realiseLigne)} commandé` : "— pas encore commandé"}</span>
                      </div>
                      <p className="mt-1 flex items-start gap-1 text-[10px] font-medium text-primary-700">
                        <Target size={10} className="mt-0.5 shrink-0" />
                        {missionForAccount(account)}
                      </p>
                      {allocation.length > 0 && (
                        <div className="mt-1.5 space-y-0.5 rounded-md bg-surface px-2 py-1">
                          <p className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                            <Stethoscope size={10} /> Répartition médecins
                          </p>
                          {allocation.slice(0, horizon === 1 ? 6 : 3).map((h) => (
                            <div key={h.hcpId} className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span className="truncate">{h.name}</span>
                              <span className="shrink-0">{formatNumber(h.boites)} b · {formatEUR(h.ca)}</span>
                            </div>
                          ))}
                          {allocation.length > (horizon === 1 ? 6 : 3) && (
                            <p className="text-[10px] text-muted-foreground/70">+{allocation.length - (horizon === 1 ? 6 : 3)} autre(s)</p>
                          )}
                        </div>
                      )}
                      {f.note && (
                        <p className={`mt-1 text-[10px] text-muted-foreground ${horizon === 1 ? "" : "line-clamp-2"}`}>
                          {f.note}
                        </p>
                      )}
                      <input
                        type="text"
                        defaultValue={f.commentaire ?? ""}
                        placeholder="Commentaire — quoi proposer..."
                        onBlur={(e) => updateForecastCommentaire(f.id, e.target.value)}
                        className="mt-1 w-full rounded border border-dashed border-border bg-transparent px-1.5 py-1 text-[10px] text-foreground placeholder:text-muted-foreground/60 hover:border-primary/50 focus:border-primary focus:outline-none"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? "border-primary-100 bg-primary-50" : "border-border"}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent ? "text-primary-700" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function Gauge({ label, value, left, right }: { label: string; value: number; left: string; right: string }) {
  const pct = Math.min(Math.max(value, 0), 1);
  const color = pct >= 1 ? "bg-success" : pct >= 0.6 ? "bg-primary" : "bg-amber-400";
  return (
    <div className="mb-2.5">
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{formatPct(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-muted">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

function OpportunityCard({
  opportunity,
  months,
  isDragging,
  onDragStart,
  onDragEnd,
  onPlan,
}: {
  opportunity: Opportunity;
  months: { year: number; month: number }[];
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onPlan: (year: number, month: number) => void;
}) {
  const meta = OPPORTUNITY_META[opportunity.type];
  const [selected, setSelected] = useState(`${months[0]?.year}-${months[0]?.month}`);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/account-id", opportunity.account.id);
        e.dataTransfer.effectAllowed = "copy";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`cursor-grab rounded-lg border border-border bg-surface p-2.5 transition-opacity active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <GripVertical size={13} className="shrink-0 text-muted-foreground" />
        <SegmentBadge segment={opportunity.account.segment} />
        <span className="truncate text-xs font-medium text-foreground">{opportunity.account.name}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
          style={{ backgroundColor: meta.color }}
        >
          {meta.label}
        </span>
        <span className="text-[10px] font-medium text-muted-foreground">{formatEUR(opportunity.value)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{opportunity.reason}</p>
      {/* Alternative fiable au glisser-déposer (peu fiable sur trackpad/Safari) :
          planifier directement via un sélecteur de mois + bouton. */}
      <div className="mt-1.5 flex items-center gap-1">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex-1 rounded border border-border bg-surface px-1.5 py-1 text-[10px] outline-none focus:border-primary"
        >
          {months.map((m) => (
            <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
              {MONTH_LABELS[m.month - 1]} {m.year}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const [y, m] = selected.split("-").map(Number);
            onPlan(y, m);
          }}
          className="shrink-0 rounded bg-primary px-2 py-1 text-[10px] font-medium text-white hover:bg-primary-600"
        >
          Planifier
        </button>
      </div>
    </div>
  );
}
