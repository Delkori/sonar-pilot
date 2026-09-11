import type { Account } from "@/types/database";
import { recurrenceBucket, type RecurrenceBucket } from "@/lib/accounts";
import { currentMonthIndex, fromMonthIndex, monthIndex, monthIndexFromDateStr } from "@/lib/dates";
import { computeBrandVelocities, type PurchaseLine } from "@/lib/sonarscore/velocity";
import { predictNextOrders } from "@/lib/sonarscore/prediction";
import { median } from "@/lib/stats";

/**
 * Probabilité qu'un compte passe commande dans les N prochains mois,
 * apprise sur l'historique réel du portefeuille — pas un barème à poids
 * fixes.
 *
 * Principe : chaque (compte, mois passé) est un exemple. On observe l'état
 * du compte à ce mois-là (cadence, retard dans son cycle, activité récente,
 * tendance, saisonnalité, segment, tier, référence attendue) en n'utilisant
 * que ce qui était connu à l'époque, puis on regarde s'il a commandé dans
 * les N mois suivants. Sur des milliers d'exemples de ce type, on mesure
 * pour chaque critère la fréquence réelle de commande — c'est ce que la
 * page « Probabilités » affiche critère par critère — et on les combine en
 * une probabilité par compte (naïve bayésienne, puis recalibrée sur une
 * fenêtre temporelle tenue à l'écart de l'apprentissage).
 *
 * Tout est explicable : la probabilité d'un compte se décompose en facteurs
 * dont chacun renvoie à un taux observé sur des comptes comparables. Et tout
 * est évalué : score de Brier, AUC et table de fiabilité sur les derniers
 * mois, pour dire au commercial à quel point il peut s'y fier.
 */

export type Horizon = 1 | 3 | 6;

export interface SaleRow {
  account_id: string;
  year: number;
  month: number;
  ca: number;
}

export type CriterionKey =
  | "cadence"
  | "retard"
  | "activite"
  | "tendance"
  | "saison"
  | "segment"
  | "tier"
  | "produit";

export interface CriterionMeta {
  key: CriterionKey;
  label: string;
  description: string;
  /** Niveaux dans l'ordre d'affichage souhaité. */
  levels: { value: string; label: string }[];
}

export const CRITERIA: CriterionMeta[] = [
  {
    key: "cadence",
    label: "Cadence de commande",
    description: "Rythme moyen entre deux commandes, mesuré sur l'historique du compte.",
    levels: [
      { value: "Mensuelle", label: "Mensuelle" },
      { value: "Bimestrielle", label: "Bimestrielle" },
      { value: "Trimestrielle", label: "Trimestrielle" },
      { value: "Espacée", label: "Espacée" },
      { value: "Unique", label: "Une seule commande" },
      { value: "Jamais", label: "Jamais commandé" },
    ],
  },
  {
    key: "retard",
    label: "Position dans le cycle",
    description: "Temps écoulé depuis la dernière commande, rapporté au rythme habituel du compte.",
    levels: [
      { value: "debut_de_cycle", label: "Début de cycle (vient de commander)" },
      { value: "fin_de_cycle", label: "Fin de cycle (commande imminente)" },
      { value: "du", label: "Commande due (1 à 2 cycles)" },
      { value: "en_retard", label: "En retard (2 à 4 cycles)" },
      { value: "decroche", label: "Décroché (plus de 4 cycles)" },
      { value: "jamais", label: "Jamais commandé" },
    ],
  },
  {
    key: "activite",
    label: "Commandes sur 12 mois",
    description: "Nombre de mois avec commande sur les douze derniers mois.",
    levels: [
      { value: "6+", label: "6 et plus" },
      { value: "3-5", label: "3 à 5" },
      { value: "1-2", label: "1 ou 2" },
      { value: "0", label: "Aucune" },
    ],
  },
  {
    key: "tendance",
    label: "Tendance sur 6 mois",
    description: "CA des six derniers mois comparé aux six mois précédents.",
    levels: [
      { value: "hausse", label: "En hausse (> +20 %)" },
      { value: "stable", label: "Stable" },
      { value: "baisse", label: "En baisse (< −20 %)" },
      { value: "sans_base", label: "Pas de base de comparaison" },
    ],
  },
  {
    key: "saison",
    label: "Saisonnalité",
    description: "Le compte commandait-il aux mêmes mois l'année précédente ?",
    levels: [
      { value: "oui", label: "Commandait aux mêmes mois l'an dernier" },
      { value: "non", label: "Ne commandait pas à cette période" },
      { value: "sans_historique", label: "Moins d'un an d'historique" },
    ],
  },
  {
    key: "segment",
    label: "Segment Salesforce",
    description: "Segment A à E du compte.",
    levels: [
      { value: "A", label: "A" },
      { value: "B", label: "B" },
      { value: "C", label: "C" },
      { value: "D", label: "D" },
      { value: "E", label: "E" },
      { value: "inconnu", label: "Non renseigné" },
    ],
  },
  {
    key: "tier",
    label: "Tier de contrat",
    description: "Liste de prix négociée.",
    levels: [
      { value: "Pro+", label: "Pro+" },
      { value: "Pro", label: "Pro" },
      { value: "Premium", label: "Premium" },
      { value: "inconnu", label: "Non renseigné" },
    ],
  },
  {
    key: "produit",
    label: "Référence attendue",
    description:
      "Une référence précise arrive à échéance de réassort dans l'horizon, d'après le rythme du compte ou la vélocité de la marque.",
    levels: [
      { value: "oui", label: "Oui" },
      { value: "non", label: "Non" },
      { value: "sans_donnees", label: "Pas de détail produit" },
    ],
  },
];

export type Features = Record<CriterionKey, string>;

export interface Example {
  accountId: string;
  /** Mois de référence (index absolu). */
  t: number;
  features: Features;
  /** Le compte a-t-il commandé dans (t, t + horizon] ? */
  ordered: boolean;
}

export interface LevelStat {
  value: string;
  label: string;
  n: number;
  /** Fréquence de commande observée sur les exemples de ce niveau. */
  rate: number;
  /** Poids appris (log-odds), signe = sens de l'effet, 0 = neutre. */
  weight: number;
}

export interface CriterionStat {
  key: CriterionKey;
  label: string;
  description: string;
  levels: LevelStat[];
}

export interface ReliabilityBin {
  /** Borne basse de la tranche de probabilité prédite. */
  from: number;
  to: number;
  n: number;
  predicted: number;
  observed: number;
}

export interface Evaluation {
  /** Exemples de la fenêtre d'évaluation (les plus récents observables). */
  n: number;
  /** Mois couverts par la fenêtre d'évaluation. */
  window: { from: { year: number; month: number }; to: { year: number; month: number } } | null;
  /** Score de Brier des probabilités calibrées (0 = parfait). */
  brier: number | null;
  /** Score de Brier si l'on prédisait le taux de base partout. */
  brierBase: number | null;
  /** Score de Brier des probabilités brutes, avant recalibration. */
  brierRaw: number | null;
  /** Aire sous la courbe ROC : 0,5 = hasard, 1 = tri parfait. */
  auc: number | null;
  reliability: ReliabilityBin[];
  /** Recalibration effectivement appliquée (fenêtre assez fournie). */
  calibrated: boolean;
}

export interface AccountProbability {
  accountId: string;
  probability: number;
  features: Features;
  /** Facteurs triés par influence décroissante. */
  factors: { key: CriterionKey; label: string; level: string; levelLabel: string; rate: number; weight: number }[];
  /** Mois de la dernière commande connue, ou null. */
  lastOrder: { year: number; month: number } | null;
  /** CA typique d'un mois avec commande (médiane sur 12 mois, sinon historique). */
  typicalOrderCa: number;
  /** Commandes attendues sur l'horizon si le compte commande (selon sa cadence). */
  expectedOrdersIfActive: number;
  /** probabilité × CA typique × commandes attendues. */
  expectedCa: number;
}

export interface ProbabilityModel {
  horizon: Horizon;
  asOf: { year: number; month: number };
  baseRate: number;
  sampleSize: number;
  trainingSize: number;
  criteria: CriterionStat[];
  evaluation: Evaluation;
  accounts: AccountProbability[];
  /** Somme des probabilités = nombre de comptes attendus en commande. */
  expectedOrderingAccounts: number;
  expectedCa: number;
}

// ── Préparation des données ──────────────────────────────────────────────

const EXPECTED_GAP: Record<RecurrenceBucket, number | null> = {
  Mensuelle: 1,
  Bimestrielle: 2,
  Trimestrielle: 3,
  Espacée: 6,
  Unique: null,
};

interface AccountHistory {
  /** CA par mois (index absolu), uniquement les mois avec commande. */
  caByMonth: Map<number, number>;
  /** Mois avec commande, triés. */
  orderedMonths: number[];
}

function buildHistories(sales: SaleRow[]): Map<string, AccountHistory> {
  const map = new Map<string, AccountHistory>();
  for (const s of sales) {
    if (!(s.ca > 0)) continue;
    const idx = monthIndex(s.year, s.month);
    const h = map.get(s.account_id) ?? { caByMonth: new Map(), orderedMonths: [] };
    h.caByMonth.set(idx, (h.caByMonth.get(idx) ?? 0) + s.ca);
    map.set(s.account_id, h);
  }
  for (const h of map.values()) h.orderedMonths = [...h.caByMonth.keys()].sort((a, b) => a - b);
  return map;
}

/** Mois commandés ≤ t — la vue « telle qu'elle était à l'époque ». */
function orderedUpTo(h: AccountHistory | undefined, t: number): number[] {
  if (!h) return [];
  // orderedMonths est trié : on s'arrête au premier mois > t.
  const out: number[] = [];
  for (const m of h.orderedMonths) {
    if (m > t) break;
    out.push(m);
  }
  return out;
}

function sumCa(h: AccountHistory | undefined, from: number, to: number): number {
  if (!h) return 0;
  let s = 0;
  for (const m of h.orderedMonths) {
    if (m < from) continue;
    if (m > to) break;
    s += h.caByMonth.get(m) ?? 0;
  }
  return s;
}

/**
 * Position dans le cycle de commande, en fraction du rythme habituel. La
 * première moitié du cycle et la seconde sont distinguées : à horizon d'un
 * mois, « vient de commander » et « commande imminente » n'ont pas du tout
 * la même probabilité, alors qu'un seul niveau « dans le cycle » les
 * confondait (un trimestriel à 1 ou 2 mois de sa dernière commande).
 */
function retardLevel(cadence: RecurrenceBucket | "Jamais", gap: number | null): string {
  if (gap === null) return "jamais";
  const expected = cadence === "Jamais" ? null : EXPECTED_GAP[cadence];
  if (expected === null) {
    // Commande unique : pas de cycle mesuré, on raisonne en absolu.
    if (gap <= 1) return "debut_de_cycle";
    if (gap <= 3) return "fin_de_cycle";
    if (gap <= 6) return "du";
    if (gap <= 12) return "en_retard";
    return "decroche";
  }
  const ratio = gap / expected;
  if (ratio < 0.5) return "debut_de_cycle";
  if (ratio < 1) return "fin_de_cycle";
  if (ratio < 2) return "du";
  if (ratio < 4) return "en_retard";
  return "decroche";
}

interface ProductSignal {
  /** Comptes ayant au moins une ligne produit connue à t. */
  known: Set<string>;
  /** Comptes dont une référence est attendue dans (t, t + horizon]. */
  due: Set<string>;
}

/**
 * Signal produit à un mois de référence : lignes d'achat ≤ t uniquement,
 * vélocités recalculées sur ces seules lignes — sinon la vélocité
 * « connaîtrait » des achats postérieurs au mois qu'on est censé prédire.
 */
function productSignalAt(lines: PurchaseLine[], t: number, horizon: Horizon): ProductSignal {
  const known = new Set<string>();
  const due = new Set<string>();
  if (lines.length === 0) return { known, due };
  const visible = lines.filter((l) => monthIndexFromDateStr(l.purchase_date) <= t);
  for (const l of visible) known.add(l.account_id);
  const velocities = computeBrandVelocities(visible);
  for (const p of predictNextOrders(visible, velocities)) {
    if (!p.expectedNextOrderDate) continue;
    const idx = monthIndexFromDateStr(p.expectedNextOrderDate);
    if (idx > t && idx <= t + horizon) due.add(p.accountId);
  }
  return { known, due };
}

interface Context {
  histories: Map<string, AccountHistory>;
  accountById: Map<string, Account>;
  minMonth: number;
  horizon: Horizon;
  productAt: (t: number) => ProductSignal;
}

function featuresAt(accountId: string, t: number, ctx: Context): Features {
  const account = ctx.accountById.get(accountId);
  const h = ctx.histories.get(accountId);
  const ordered = orderedUpTo(h, t);
  const last = ordered.length > 0 ? ordered[ordered.length - 1] : null;

  const cadence: RecurrenceBucket | "Jamais" = ordered.length === 0 ? "Jamais" : recurrenceBucket(ordered);
  const gap = last === null ? null : t - last;

  const orders12 = ordered.filter((m) => m > t - 12).length;
  const activite = orders12 >= 6 ? "6+" : orders12 >= 3 ? "3-5" : orders12 >= 1 ? "1-2" : "0";

  const recent = sumCa(h, t - 5, t);
  const previous = sumCa(h, t - 11, t - 6);
  let tendance: string;
  if (previous <= 0) tendance = "sans_base";
  else {
    const delta = (recent - previous) / previous;
    tendance = delta > 0.2 ? "hausse" : delta < -0.2 ? "baisse" : "stable";
  }

  // Les mois ciblés (t+1 … t+H), un an plus tôt : il faut que la fenêtre de
  // données remonte assez loin pour en juger.
  let saison: string;
  if (t + 1 - 12 < ctx.minMonth) saison = "sans_historique";
  else {
    let oui = false;
    for (let k = 1; k <= ctx.horizon; k++) {
      if (h?.caByMonth.has(t + k - 12)) {
        oui = true;
        break;
      }
    }
    saison = oui ? "oui" : "non";
  }

  const segment = account?.segment ?? "inconnu";
  const tier =
    account?.price_list === "Premium" || account?.price_list === "Pro" || account?.price_list === "Pro+"
      ? account.price_list
      : "inconnu";

  const signal = ctx.productAt(t);
  const produit = !signal.known.has(accountId) ? "sans_donnees" : signal.due.has(accountId) ? "oui" : "non";

  return {
    cadence,
    retard: retardLevel(cadence, gap),
    activite,
    tendance,
    saison,
    segment,
    tier,
    produit,
  };
}

// ── Apprentissage ────────────────────────────────────────────────────────

/** Une colonne par (critère, niveau) déclaré, plus l'ordonnée à l'origine. */
const COLUMNS: { key: CriterionKey; value: string }[] = CRITERIA.flatMap((c) =>
  c.levels.map((l) => ({ key: c.key, value: l.value }))
);
const COLUMN_INDEX = new Map(COLUMNS.map((col, j) => [`${col.key}|${col.value}`, j] as const));
const INTERCEPT = COLUMNS.length;
const DIM = COLUMNS.length + 1;

/** Régularisation L2 (hors ordonnée à l'origine) : borne les poids quand un
 *  niveau n'a été vu qu'avec une seule issue, sans les écraser. */
const RIDGE = 2;

function activeColumns(features: Features): number[] {
  const cols: number[] = [];
  for (const c of CRITERIA) {
    const j = COLUMN_INDEX.get(`${c.key}|${features[c.key]}`);
    if (j !== undefined) cols.push(j);
  }
  cols.push(INTERCEPT);
  return cols;
}

interface Model {
  weights: Float64Array;
}

function dot(weights: Float64Array, cols: number[]): number {
  let z = 0;
  for (const j of cols) z += weights[j];
  return z;
}

/** Résout H·x = g (H symétrique définie positive) par élimination de Gauss avec pivot. */
function solve(H: Float64Array[], g: Float64Array): Float64Array {
  const n = g.length;
  const A = H.map((row) => Float64Array.from(row));
  const b = Float64Array.from(g);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[pivot][k])) pivot = i;
    if (pivot !== k) {
      [A[k], A[pivot]] = [A[pivot], A[k]];
      [b[k], b[pivot]] = [b[pivot], b[k]];
    }
    const akk = A[k][k];
    if (Math.abs(akk) < 1e-12) continue;
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / akk;
      if (f === 0) continue;
      for (let j = k; j < n; j++) A[i][j] -= f * A[k][j];
      b[i] -= f * b[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) sum -= A[i][j] * x[j];
    x[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : sum / A[i][i];
  }
  return x;
}

/**
 * Régression logistique par méthode de Newton (IRLS), régularisée en L2.
 * Les vecteurs d'entrée sont creux (un niveau actif par critère), ce qui
 * rend chaque itération très bon marché malgré la matrice hessienne.
 */
function trainLogistic(examples: Example[]): Model {
  const weights = new Float64Array(DIM);
  if (examples.length === 0) return { weights };
  const rows = examples.map((e) => ({ cols: activeColumns(e.features), y: e.ordered ? 1 : 0 }));

  for (let iter = 0; iter < 30; iter++) {
    const g = new Float64Array(DIM);
    const H: Float64Array[] = Array.from({ length: DIM }, () => new Float64Array(DIM));
    for (const { cols, y } of rows) {
      const p = sigmoid(dot(weights, cols));
      const d = p - y;
      const w = p * (1 - p);
      for (const a of cols) {
        g[a] += d;
        for (const b of cols) H[a][b] += w;
      }
    }
    for (let j = 0; j < INTERCEPT; j++) {
      g[j] += RIDGE * weights[j];
      H[j][j] += RIDGE;
    }
    H[INTERCEPT][INTERCEPT] += 1e-6;

    const step = solve(H, g);
    let maxStep = 0;
    for (let j = 0; j < DIM; j++) {
      weights[j] -= step[j];
      maxStep = Math.max(maxStep, Math.abs(step[j]));
    }
    if (maxStep < 1e-6) break;
  }
  return { weights };
}

function levelWeight(model: Model, key: CriterionKey, value: string): number {
  const j = COLUMN_INDEX.get(`${key}|${value}`);
  return j === undefined ? 0 : model.weights[j];
}

function rawLogit(model: Model, features: Features): number {
  return dot(model.weights, activeColumns(features));
}

/** Comptage descriptif par critère et niveau. */
interface Counts {
  pos: number;
  neg: number;
  perLevel: Record<CriterionKey, Map<string, { pos: number; neg: number }>>;
}

function countExamples(examples: Example[]): Counts {
  const perLevel = Object.fromEntries(CRITERIA.map((c) => [c.key, new Map()])) as Counts["perLevel"];
  let pos = 0;
  let neg = 0;
  for (const ex of examples) {
    if (ex.ordered) pos++;
    else neg++;
    for (const c of CRITERIA) {
      const level = ex.features[c.key];
      const cell = perLevel[c.key].get(level) ?? { pos: 0, neg: 0 };
      if (ex.ordered) cell.pos++;
      else cell.neg++;
      perLevel[c.key].set(level, cell);
    }
  }
  return { pos, neg, perLevel };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const clamp = (p: number) => Math.min(0.99, Math.max(0.01, p));

/**
 * Recalibration de Platt : p = σ(a·z + b), (a, b) ajustés par maximum de
 * vraisemblance (Newton) sur des exemples que l'apprentissage n'a pas vus.
 * Les critères sont corrélés entre eux (cadence, retard et activité disent
 * en partie la même chose), ce qui rend la combinaison naïve trop sûre
 * d'elle : deux paramètres suffisent à ramener les probabilités à leur
 * fréquence réelle.
 */
function fitPlatt(points: { z: number; y: boolean }[]): { a: number; b: number } {
  let a = 1;
  let b = 0;
  const ridge = 1e-3;
  for (let iter = 0; iter < 50; iter++) {
    let ga = ridge * (a - 1);
    let gb = ridge * b;
    let haa = ridge;
    let hab = 0;
    let hbb = ridge;
    for (const { z, y } of points) {
      const p = sigmoid(a * z + b);
      const d = p - (y ? 1 : 0);
      const w = p * (1 - p);
      ga += d * z;
      gb += d;
      haa += w * z * z;
      hab += w * z;
      hbb += w;
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) < 1e-6 && Math.abs(db) < 1e-6) break;
  }
  // Une pente négative inverserait le classement : on n'accepte qu'un
  // recadrage, jamais un retournement.
  if (!(a > 0) || !Number.isFinite(a) || !Number.isFinite(b)) return { a: 1, b: 0 };
  return { a, b };
}

function brierScore(points: { p: number; y: boolean }[]): number | null {
  if (points.length === 0) return null;
  return points.reduce((s, { p, y }) => s + (p - (y ? 1 : 0)) ** 2, 0) / points.length;
}

/** AUC par statistique de Mann-Whitney (gestion des ex æquo). */
function auc(points: { p: number; y: boolean }[]): number | null {
  const pos = points.filter((x) => x.y).length;
  const neg = points.length - pos;
  if (pos === 0 || neg === 0) return null;
  const sorted = [...points].sort((x, y) => x.p - y.p);
  let rankSum = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].p === sorted[i].p) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (sorted[k].y) rankSum += avgRank;
    i = j + 1;
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

function reliabilityBins(points: { p: number; y: boolean }[]): ReliabilityBin[] {
  const bins: ReliabilityBin[] = Array.from({ length: 10 }, (_, i) => ({
    from: i / 10,
    to: (i + 1) / 10,
    n: 0,
    predicted: 0,
    observed: 0,
  }));
  for (const { p, y } of points) {
    const b = bins[Math.min(9, Math.floor(p * 10))];
    b.n++;
    b.predicted += p;
    b.observed += y ? 1 : 0;
  }
  return bins.map((b) => ({
    ...b,
    predicted: b.n > 0 ? b.predicted / b.n : 0,
    observed: b.n > 0 ? b.observed / b.n : 0,
  }));
}

// ── API ──────────────────────────────────────────────────────────────────

export interface BuildOptions {
  accounts: Account[];
  monthlySales: SaleRow[];
  purchaseLines?: PurchaseLine[];
  horizon: Horizon;
  /** Mois de référence pour le scoring (défaut : mois en cours). */
  asOf?: { year: number; month: number };
  /** Mois réservés à l'évaluation et à la recalibration (défaut : 6). */
  validationMonths?: number;
}

/** Exemples (compte × mois de référence) avec leur étiquette, sans fuite du futur. */
export function buildExamples(opts: BuildOptions): { examples: Example[]; ctx: Context; asOfIdx: number } {
  const horizon = opts.horizon;
  const asOfIdx = opts.asOf ? monthIndex(opts.asOf.year, opts.asOf.month) : currentMonthIndex();
  const histories = buildHistories(opts.monthlySales);
  const accountById = new Map(opts.accounts.map((a) => [a.id, a] as const));

  const allMonths = opts.monthlySales.filter((s) => s.ca > 0).map((s) => monthIndex(s.year, s.month));
  const minMonth = allMonths.length > 0 ? Math.min(...allMonths) : asOfIdx;

  const productCache = new Map<number, ProductSignal>();
  const lines = opts.purchaseLines ?? [];
  const productAt = (t: number) => {
    const cached = productCache.get(t);
    if (cached) return cached;
    const sig = productSignalAt(lines, t, horizon);
    productCache.set(t, sig);
    return sig;
  };

  const ctx: Context = { histories, accountById, minMonth, horizon, productAt };

  // Le mois en cours est partiel : le dernier mois entièrement observé est
  // celui d'avant, et une étiquette n'est complète que si les H mois qui
  // suivent le mois de référence sont eux-mêmes entièrement observés.
  const lastComplete = asOfIdx - 1;
  const firstT = minMonth;
  const lastT = lastComplete - horizon;

  const examples: Example[] = [];
  if (lastT < firstT) return { examples, ctx, asOfIdx };

  for (const account of opts.accounts) {
    const h = histories.get(account.id);
    for (let t = firstT; t <= lastT; t++) {
      let ordered = false;
      if (h) {
        for (let k = 1; k <= horizon; k++) {
          if (h.caByMonth.has(t + k)) {
            ordered = true;
            break;
          }
        }
      }
      examples.push({ accountId: account.id, t, features: featuresAt(account.id, t, ctx), ordered });
    }
  }
  return { examples, ctx, asOfIdx };
}

export function buildProbabilityModel(opts: BuildOptions): ProbabilityModel {
  const { examples, ctx, asOfIdx } = buildExamples(opts);
  const horizon = opts.horizon;
  const validationMonths = opts.validationMonths ?? 6;

  // Fenêtre d'évaluation : les mois de référence les plus récents dont
  // l'issue est connue. L'apprentissage ne les voit pas.
  const ts = examples.map((e) => e.t);
  const maxT = ts.length > 0 ? Math.max(...ts) : asOfIdx;
  const minT = ts.length > 0 ? Math.min(...ts) : asOfIdx;
  const spanMonths = maxT - minT + 1;
  const validationSpan = spanMonths >= validationMonths + 6 ? validationMonths : Math.max(0, Math.floor(spanMonths / 3));
  const cutoff = maxT - validationSpan + 1;

  const train = validationSpan > 0 ? examples.filter((e) => e.t < cutoff) : examples;
  const validation = validationSpan > 0 ? examples.filter((e) => e.t >= cutoff) : [];

  const model = trainLogistic(train);
  const trainCounts = countExamples(train);
  const all = countExamples(examples);

  // Recalibration : on exige une fenêtre avec les deux issues représentées.
  const validationPoints = validation.map((e) => ({ z: rawLogit(model, e.features), y: e.ordered }));
  const enoughToCalibrate =
    validationPoints.length >= 30 && validationPoints.some((p) => p.y) && validationPoints.some((p) => !p.y);
  const platt = enoughToCalibrate ? fitPlatt(validationPoints) : { a: 1, b: 0 };
  const calibrate = (z: number) => clamp(sigmoid(platt.a * z + platt.b));

  const baseRateTrain =
    trainCounts.pos + trainCounts.neg > 0 ? trainCounts.pos / (trainCounts.pos + trainCounts.neg) : 0;
  const evalPoints = validationPoints.map(({ z, y }) => ({ p: calibrate(z), y }));
  const rawPoints = validationPoints.map(({ z, y }) => ({ p: clamp(sigmoid(z)), y }));
  const evaluation: Evaluation = {
    n: validation.length,
    window:
      validation.length > 0
        ? { from: fromMonthIndex(cutoff), to: fromMonthIndex(maxT) }
        : null,
    brier: brierScore(evalPoints),
    brierRaw: brierScore(rawPoints),
    brierBase: brierScore(validation.map((e) => ({ p: baseRateTrain, y: e.ordered }))),
    auc: auc(evalPoints),
    reliability: reliabilityBins(evalPoints),
    calibrated: enoughToCalibrate,
  };

  // Taux observés par critère, sur tous les exemples (descriptif).
  const baseRate = all.pos + all.neg > 0 ? all.pos / (all.pos + all.neg) : 0;
  const criteria: CriterionStat[] = CRITERIA.map((c) => ({
    key: c.key,
    label: c.label,
    description: c.description,
    levels: c.levels
      .map((lv) => {
        const cell = all.perLevel[c.key].get(lv.value) ?? { pos: 0, neg: 0 };
        const n = cell.pos + cell.neg;
        return {
          value: lv.value,
          label: lv.label,
          n,
          rate: n > 0 ? cell.pos / n : 0,
          weight: levelWeight(model, c.key, lv.value),
        };
      })
      .filter((lv) => lv.n > 0),
  }));
  const levelStat = (key: CriterionKey, value: string) =>
    criteria.find((c) => c.key === key)?.levels.find((l) => l.value === value);

  // Scoring à date : l'état actuel de chaque compte, avec tout l'historique.
  const accounts: AccountProbability[] = opts.accounts.map((account) => {
    const features = featuresAt(account.id, asOfIdx, ctx);
    const probability = calibrate(rawLogit(model, features));
    const h = ctx.histories.get(account.id);
    const ordered = orderedUpTo(h, asOfIdx);
    const last = ordered.length > 0 ? ordered[ordered.length - 1] : null;

    const recentCa = ordered.filter((m) => m > asOfIdx - 12).map((m) => h!.caByMonth.get(m) ?? 0);
    const typicalOrderCa = median(recentCa) ?? median(ordered.map((m) => h!.caByMonth.get(m) ?? 0)) ?? 0;

    const cadence = features.cadence as RecurrenceBucket | "Jamais";
    const gap = cadence === "Jamais" ? null : EXPECTED_GAP[cadence];
    const expectedOrdersIfActive = gap ? Math.max(1, Math.min(horizon, horizon / gap)) : 1;

    const factors = CRITERIA.map((c) => {
      const lv = levelStat(c.key, features[c.key]);
      const meta = c.levels.find((l) => l.value === features[c.key]);
      return {
        key: c.key,
        label: c.label,
        level: features[c.key],
        levelLabel: meta?.label ?? features[c.key],
        rate: lv?.rate ?? baseRate,
        weight: levelWeight(model, c.key, features[c.key]),
      };
    }).sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight));

    return {
      accountId: account.id,
      probability,
      features,
      factors,
      lastOrder: last === null ? null : fromMonthIndex(last),
      typicalOrderCa,
      expectedOrdersIfActive,
      expectedCa: probability * typicalOrderCa * expectedOrdersIfActive,
    };
  });

  return {
    horizon,
    asOf: fromMonthIndex(asOfIdx),
    baseRate,
    sampleSize: examples.length,
    trainingSize: train.length,
    criteria,
    evaluation,
    accounts,
    expectedOrderingAccounts: accounts.reduce((s, a) => s + a.probability, 0),
    expectedCa: accounts.reduce((s, a) => s + a.expectedCa, 0),
  };
}
