/**
 * Banc de mesure du modèle de probabilité de commande, sur les données
 * réelles du portefeuille — sans rien écrire en base.
 *
 *   npx tsx scripts/evaluate-probability.ts --data <dossier>
 *
 * Le dossier contient quatre fichiers JSON exportés de Supabase :
 *   accounts.json        [{ id, segment, status, price_list }]
 *   monthly_sales.json   [{ account_id, year, month, ca }]
 *   purchases.json       [{ account_id, brand, purchase_date, qty }]
 *   forecasts.json       [{ account_id, year, month, source, created_at, ca_prevu }]
 *
 * Deux lectures :
 *  1. ce que l'onglet Analyse › Probabilités affiche aujourd'hui (fenêtre
 *     d'évaluation interne du modèle) ;
 *  2. un test en aveugle à origines glissantes : le modèle est réappris à
 *     chaque mois T du passé avec les seules données connues à T, ses
 *     probabilités sont confrontées aux commandes réellement passées
 *     dans (T, T + H]. C'est la mesure honnête : rien de ce qui suit T
 *     n'a servi, ni à l'apprentissage, ni à la recalibration.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProbabilityModel, CRITERIA } from "@/lib/probability";
import type { ForecastSignalRow, Horizon, SaleRow } from "@/lib/probability";
import type { PurchaseLine } from "@/lib/sonarscore/velocity";
import { fromMonthIndex, monthIndex, MONTHS_SHORT } from "@/lib/dates";
import type { Account } from "@/types/database";

// ── Données ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dataDir = args[args.indexOf("--data") + 1];
if (!dataDir || args.indexOf("--data") < 0) {
  console.error("Usage : npx tsx scripts/evaluate-probability.ts --data <dossier>");
  process.exit(1);
}
const load = <T,>(f: string): T => JSON.parse(readFileSync(join(dataDir, f), "utf8")) as T;
const accounts = load<Account[]>("accounts.json");
const monthlySales = load<SaleRow[]>("monthly_sales.json");
const purchaseLines = load<PurchaseLine[]>("purchases.json");
const forecasts = load<ForecastSignalRow[]>("forecasts.json");

const positiveMonths = monthlySales.filter((s) => s.ca > 0).map((s) => monthIndex(s.year, s.month));
const lastDataIdx = Math.max(...positiveMonths);
const firstDataIdx = Math.min(...positiveMonths);
const label = (idx: number) => {
  const { year, month } = fromMonthIndex(idx);
  return `${MONTHS_SHORT[month - 1]} ${year}`;
};
const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)} %`);
const num = (x: number | null, d = 3) => (x === null ? "—" : x.toFixed(d));

console.log(`Portefeuille : ${accounts.length} comptes, ${monthlySales.length} lignes de ventes mensuelles (${label(firstDataIdx)} → ${label(lastDataIdx)}), ${purchaseLines.length} lignes d'achats, ${forecasts.length} prévisions (${forecasts.filter((f) => f.source === "manuel").length} manuelles).`);
const ordering = new Set(monthlySales.filter((s) => s.ca > 0).map((s) => s.account_id));
console.log(`Comptes ayant déjà commandé : ${ordering.size} — les ${accounts.length - ordering.size} autres n'ont aucune vente (prospects, perdus, dormants).\n`);

// ── Métriques ────────────────────────────────────────────────────────────
type Point = { p: number; y: boolean };
const brier = (pts: Point[]) => (pts.length ? pts.reduce((s, q) => s + (q.p - (q.y ? 1 : 0)) ** 2, 0) / pts.length : null);
function auc(pts: Point[]): number | null {
  const pos = pts.filter((q) => q.y).map((q) => q.p);
  const neg = pts.filter((q) => !q.y).map((q) => q.p);
  if (pos.length === 0 || neg.length === 0) return null;
  let s = 0;
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (pos.length * neg.length);
}
function bins(pts: Point[]) {
  const edges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    const inBin = pts.filter((q) => q.p >= lo && q.p < hi);
    return {
      tranche: `${Math.round(lo * 100)}–${Math.min(Math.round(hi * 100), 100)} %`,
      n: inBin.length,
      annonce: inBin.length ? inBin.reduce((s, q) => s + q.p, 0) / inBin.length : null,
      observe: inBin.length ? inBin.filter((q) => q.y).length / inBin.length : null,
    };
  }).filter((b) => b.n > 0);
}
/** Précision parmi les comptes les mieux classés (les 10 % / 20 % de tête). */
function topPrecision(pts: Point[], share: number) {
  const sorted = [...pts].sort((a, b) => b.p - a.p);
  const k = Math.max(1, Math.round(sorted.length * share));
  const top = sorted.slice(0, k);
  return { k, precision: top.filter((q) => q.y).length / k };
}
function printBins(pts: Point[]) {
  console.log("    tranche annoncée   n     annoncé   observé");
  for (const b of bins(pts)) console.log(`    ${b.tranche.padEnd(16)} ${String(b.n).padStart(5)}   ${pct(b.annonce).padStart(7)}   ${pct(b.observe).padStart(7)}`);
}
function summarize(title: string, pts: Point[], baseline: Point[], naive: Point[]) {
  const b = brier(pts), bb = brier(baseline), bn = brier(naive);
  const rate = pts.filter((q) => q.y).length / pts.length;
  const skill = b !== null && bb ? 1 - b / bb : null;
  const t10 = topPrecision(pts, 0.1), t20 = topPrecision(pts, 0.2);
  console.log(`  ${title} — ${pts.length} situations, ${pct(rate)} ont commandé`);
  console.log(`    AUC modèle ${num(auc(pts), 2)}   AUC règle naïve ${num(auc(naive), 2)}`);
  console.log(`    Brier modèle ${num(b)}   taux de base ${num(bb)}   règle naïve ${num(bn)}   gain sur le taux de base ${pct(skill)}`);
  console.log(`    10 % de tête (${t10.k} comptes) : ${pct(t10.precision)} commandent   20 % de tête (${t20.k}) : ${pct(t20.precision)}   (contre ${pct(rate)} au hasard)`);
  printBins(pts);
}

// ── 1. Ce que la page affiche ────────────────────────────────────────────
console.log("═══ 1. Évaluation interne (ce que l'onglet Analyse affiche aujourd'hui) ═══");
for (const horizon of [1, 3, 6] as Horizon[]) {
  const m = buildProbabilityModel({ accounts, monthlySales, purchaseLines, forecasts, horizon });
  const e = m.evaluation;
  const skill = e.brier !== null && e.brierBase ? 1 - e.brier / e.brierBase : null;
  console.log(`\nHorizon ${horizon} mois — ${m.sampleSize} situations, ${m.trainingSize} apprises, ${e.n} évaluées${e.window ? ` (${label(monthIndex(e.window.from.year, e.window.from.month))} → ${label(monthIndex(e.window.to.year, e.window.to.month))})` : ""}, taux de base ${pct(m.baseRate)}`);
  console.log(`  AUC ${num(e.auc, 2)}   Brier ${num(e.brier)} (brut ${num(e.brierRaw)}) contre ${num(e.brierBase)} au taux de base → gain ${pct(skill)}   recalibré : ${e.calibrated ? "oui" : "non"}`);
  console.log(`  Comptes attendus en commande : ${m.expectedOrderingAccounts.toFixed(1)}   CA attendu : ${Math.round(m.expectedCa)} €`);
  const evalPts = e.reliability.flatMap((r) => r); // non exploitable directement : on réaffiche les tranches internes
  void evalPts;
  console.log("    tranche   n     annoncé   observé");
  for (const r of e.reliability) if (r.n > 0) console.log(`    ${`${Math.round(r.from * 100)}–${Math.round(r.to * 100)} %`.padEnd(9)} ${String(r.n).padStart(5)}   ${pct(r.predicted).padStart(7)}   ${pct(r.observed).padStart(7)}`);
}

// ── 2. Test en aveugle ───────────────────────────────────────────────────
console.log("\n═══ 2. Test en aveugle — modèle réappris à chaque mois T, confronté aux commandes de (T, T+H] ═══");
const orderedByAccount = new Map<string, Set<number>>();
for (const s of monthlySales) {
  if (s.ca <= 0) continue;
  const set = orderedByAccount.get(s.account_id) ?? new Set<number>();
  set.add(monthIndex(s.year, s.month));
  orderedByAccount.set(s.account_id, set);
}
const orderedIn = (id: string, from: number, to: number) => {
  const set = orderedByAccount.get(id);
  if (!set) return false;
  for (let m = from; m <= to; m++) if (set.has(m)) return true;
  return false;
};
const activityLast12 = (id: string, t: number) => {
  const set = orderedByAccount.get(id);
  if (!set) return 0;
  let n = 0;
  for (let m = t - 11; m <= t; m++) if (set.has(m)) n++;
  return n;
};
const hasOrderedBefore = (id: string, t: number) => {
  const set = orderedByAccount.get(id);
  if (!set) return false;
  for (const m of set) if (m <= t) return true;
  return false;
};
const lostIds = new Set(accounts.filter((a) => a.status === "lost").map((a) => a.id));

for (const horizon of [1, 3, 6] as Horizon[]) {
  // Origines : de 18 mois après le début des données (il faut un minimum
  // d'historique pour apprendre) jusqu'au dernier mois dont la fenêtre
  // (T, T+H] est entièrement observée.
  const firstT = firstDataIdx + 17;
  const lastT = lastDataIdx - horizon;
  const all: Point[] = [], base: Point[] = [], naive: Point[] = [];
  const known: Point[] = [], knownBase: Point[] = [], knownNaive: Point[] = [];
  const perOrigin: { t: number; n: number; rate: number; auc: number | null; brier: number | null; brierBase: number | null }[] = [];
  for (let t = firstT; t <= lastT; t++) {
    const asOf = fromMonthIndex(t);
    const m = buildProbabilityModel({ accounts, monthlySales, purchaseLines, forecasts, horizon, asOf });
    const pts: Point[] = [], bpts: Point[] = [], npts: Point[] = [];
    for (const r of m.accounts) {
      if (lostIds.has(r.accountId)) continue;
      const y = orderedIn(r.accountId, t + 1, t + horizon);
      const pt = { p: r.probability, y };
      const bpt = { p: m.baseRate, y };
      const npt = { p: 1 - (1 - activityLast12(r.accountId, t) / 12) ** horizon, y };
      pts.push(pt); bpts.push(bpt); npts.push(npt);
      all.push(pt); base.push(bpt); naive.push(npt);
      if (hasOrderedBefore(r.accountId, t)) { known.push(pt); knownBase.push(bpt); knownNaive.push(npt); }
    }
    perOrigin.push({ t, n: pts.length, rate: pts.filter((q) => q.y).length / pts.length, auc: auc(pts), brier: brier(pts), brierBase: brier(bpts) });
  }
  console.log(`\nHorizon ${horizon} mois — ${perOrigin.length} origines (${label(firstT)} → ${label(lastT)}), comptes perdus exclus`);
  summarize("Tous les comptes", all, base, naive);
  summarize("Comptes ayant déjà commandé avant T (les seuls où la question se pose vraiment)", known, knownBase, knownNaive);
  console.log("  Par origine (AUC / gain de Brier sur le taux de base) :");
  console.log("    " + perOrigin.map((o) => `${label(o.t)} ${num(o.auc, 2)} / ${o.brier !== null && o.brierBase ? pct(1 - o.brier / o.brierBase) : "—"}`).join("  ·  "));
}

// ── 3. Poids appris ──────────────────────────────────────────────────────
console.log("\n═══ 3. Ce que le modèle a appris (horizon 3 mois, aujourd'hui) ═══");
const m3 = buildProbabilityModel({ accounts, monthlySales, purchaseLines, forecasts, horizon: 3 });
for (const c of m3.criteria) {
  const meta = CRITERIA.find((x) => x.key === c.key)!;
  console.log(`  ${meta.label}`);
  for (const lv of c.levels) console.log(`    ${lv.label.padEnd(40)} n=${String(lv.n).padStart(5)}  commandent ${pct(lv.rate).padStart(7)}  poids ${lv.weight >= 0 ? "+" : ""}${lv.weight.toFixed(2)}`);
}

// ── 4. Prévisions saisies et générées : réalisées ? ─────────────────────
console.log("\n═══ 4. Prévisionnel de Planning › Mois : lignes échues, réalisées ou non ═══");
for (const source of ["manuel", "auto"] as const) {
  const due = forecasts.filter((f) => f.source === source && monthIndex(f.year, f.month) <= lastDataIdx);
  const hit = due.filter((f) => orderedByAccount.get(f.account_id)?.has(monthIndex(f.year, f.month)));
  const hitWindow = due.filter((f) => orderedIn(f.account_id, monthIndex(f.year, f.month) - 1, monthIndex(f.year, f.month) + 1));
  console.log(`  ${source === "manuel" ? "Saisies à la main" : "Générées"} : ${due.length} échues, ${hit.length} réalisées le mois prévu (${due.length ? pct(hit.length / due.length) : "—"}), ${hitWindow.length} à ± 1 mois (${due.length ? pct(hitWindow.length / due.length) : "—"})`);
}
