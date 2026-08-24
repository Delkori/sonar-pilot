// Backtest du générateur Pilotage — mesure si le signal produit
// (lib/sonarscore/velocity.ts + prediction.ts, branché dans lib/forecast.ts)
// améliore réellement la prédiction, plutôt que de le supposer.
//
// Principe : on se place à une date passée ("cutoff"), on ne donne au
// générateur QUE les données disponibles avant cette date (comme s'il
// tournait réellement à ce moment-là), puis on compare ses prévisions aux
// commandes RÉELLEMENT passées ensuite (déjà en base, donc connues
// aujourd'hui). Deux variantes tournent sur les mêmes données de base :
//  - "avec signal produit" : purchaseLines fournies au générateur
//  - "sans signal produit" : purchaseLines vidées → comportement d'avant
//    l'ajout du signal (récurrence agrégée toutes marques confondues)
// Le delta entre les deux dit si le signal produit aide vraiment, pas
// seulement s'il change des chiffres.

import type { Account } from "@/types/database";
import { predictPortfolioForecast } from "./forecast";
import type { MonthlySaleRow } from "./forecast";
import { computeBrandVelocities } from "./sonarscore/velocity";
import type { PurchaseLine } from "./sonarscore/velocity";
import { predictNextOrders } from "./sonarscore/prediction";
import { FILLER_BRANDS, brandCategory } from "./brands";
import type { BrandCategory } from "./brands";

export interface BacktestPurchaseLine extends PurchaseLine {
  value_eur: number;
}

export interface BacktestVariantResult {
  label: string;
  predictedCount: number;
  hits: number;
  precision: number | null;
  actualOrderMonths: number;
  recall: number | null;
  f1: number | null;
  /** CA prévu et CA réel, uniquement sur les prédictions correctement placées (hits) — mesure le biais d'amplitude une fois le "quand" isolé du "combien". */
  predictedCaSumOnHits: number;
  actualCaSumOnHits: number;
  caBiasPct: number | null;
}

export interface BacktestResult {
  cutoff: { year: number; month: number };
  targetMonths: { year: number; month: number }[];
  withProductSignal: BacktestVariantResult;
  withoutProductSignal: BacktestVariantResult;
}

function monthIndex(year: number, month: number): number {
  return year * 12 + month;
}

function monthIndexFromDateStr(dateStr: string): number {
  const d = new Date(dateStr);
  return monthIndex(d.getFullYear(), d.getMonth() + 1);
}

function nextMonthsFrom(year: number, month: number, count: number): { year: number; month: number }[] {
  const result: { year: number; month: number }[] = [];
  let y = year;
  let m = month;
  for (let i = 0; i < count; i++) {
    result.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return result;
}

/**
 * Agrège les lignes d'achat en ventes mensuelles (compte × année × mois) —
 * même format que `account_monthly_sales`, pour alimenter la récurrence
 * agrégée du générateur (identique dans les deux variantes : seule la
 * granularité produit change entre elles, pas ce signal-là).
 */
function aggregateToMonthlySales(lines: BacktestPurchaseLine[]): MonthlySaleRow[] {
  const byKey = new Map<string, MonthlySaleRow>();
  for (const line of lines) {
    const d = new Date(line.purchase_date);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const key = `${line.account_id}-${year}-${month}`;
    const cur = byKey.get(key);
    if (cur) cur.ca += line.value_eur;
    else byKey.set(key, { account_id: line.account_id, year, month, ca: line.value_eur });
  }
  return Array.from(byKey.values());
}

function runVariant(
  label: string,
  accounts: Account[],
  knownSales: MonthlySaleRow[],
  variantPurchaseLines: BacktestPurchaseLine[],
  targetMonths: { year: number; month: number }[],
  actualByAccountMonth: Map<string, number>
): BacktestVariantResult {
  const predictions = predictPortfolioForecast(
    accounts,
    new Map(), // pas de répartition HCP pertinente pour ce backtest, non testée ici
    knownSales,
    [], // pas de saisie manuelle à rejouer dans un backtest
    targetMonths,
    [], // pas d'objectif secteur : on isole le signal produit, pas le comblement d'écart
    variantPurchaseLines
  );

  let hits = 0;
  let predictedCaSumOnHits = 0;
  let actualCaSumOnHits = 0;
  for (const p of predictions) {
    const key = `${p.account_id}-${monthIndex(p.year, p.month)}`;
    const actualCa = actualByAccountMonth.get(key) ?? 0;
    if (actualCa > 0) {
      hits++;
      predictedCaSumOnHits += p.ca_prevu;
      actualCaSumOnHits += actualCa;
    }
  }

  const actualOrderMonths = actualByAccountMonth.size;
  const precision = predictions.length > 0 ? hits / predictions.length : null;
  const recall = actualOrderMonths > 0 ? hits / actualOrderMonths : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  const caBiasPct =
    actualCaSumOnHits > 0 ? (predictedCaSumOnHits - actualCaSumOnHits) / actualCaSumOnHits : null;

  return {
    label,
    predictedCount: predictions.length,
    hits,
    precision,
    actualOrderMonths,
    recall,
    f1,
    predictedCaSumOnHits,
    actualCaSumOnHits,
    caBiasPct,
  };
}

/**
 * Reconstruit `realise_boites` et `ca_2026_ytd` tels qu'ils étaient à la
 * date de coupure, à partir des lignes d'achat déjà tronquées (`knownLines`)
 * — plutôt que d'utiliser l'état actuel du compte en base, qui reflète tout
 * l'historique jusqu'à aujourd'hui, y compris les mois postérieurs au
 * cutoff qu'on est censé ignorer.
 *
 * Sans ça, `predictMonthlyForecast` calcule `restantLeft` (objectif − déjà
 * réalisé) avec le réalisé D'AUJOURD'HUI : pour un compte qui a déjà atteint
 * ou dépassé son objectif annuel à date, `restantLeft` tombe à 0 et la
 * fonction s'arrête avant même d'évaluer un signal — quelle que soit la
 * variante testée. Résultat : des comptes exclus du backtest pour une
 * mauvaise raison (fuite d'information du futur), pas parce que le modèle
 * a jugé qu'ils n'avaient rien à prévoir.
 */
function asOfCutoffAccounts(accounts: Account[], knownLines: BacktestPurchaseLine[]): Account[] {
  const boitesByAccount = new Map<string, number>();
  const caByAccount = new Map<string, number>();
  for (const line of knownLines) {
    boitesByAccount.set(line.account_id, (boitesByAccount.get(line.account_id) ?? 0) + line.qty);
    caByAccount.set(line.account_id, (caByAccount.get(line.account_id) ?? 0) + line.value_eur);
  }
  return accounts.map((a) => ({
    ...a,
    realise_boites: boitesByAccount.get(a.id) ?? 0,
    ca_2026_ytd: caByAccount.get(a.id) ?? 0,
  }));
}

/**
 * Rejoue le générateur à une date passée (`cutoffYear`/`cutoffMonth` = premier
 * mois "inconnu" à l'époque) sur `horizonMonths` mois, et compare aux
 * commandes réellement passées ensuite. `allPurchaseLines` doit couvrir tout
 * l'historique disponible (avant ET après le cutoff) — la fonction se charge
 * de séparer "connu à l'époque" de "réalisé depuis".
 */
export function runForecastBacktest(
  accounts: Account[],
  allPurchaseLines: BacktestPurchaseLine[],
  cutoffYear: number,
  cutoffMonth: number,
  horizonMonths = 3
): BacktestResult {
  const cutoffIdx = monthIndex(cutoffYear, cutoffMonth);
  const targetMonths = nextMonthsFrom(cutoffYear, cutoffMonth, horizonMonths);
  const targetIdxSet = new Set(targetMonths.map((m) => monthIndex(m.year, m.month)));

  const knownLines = allPurchaseLines.filter((l) => monthIndexFromDateStr(l.purchase_date) < cutoffIdx);
  const actualLines = allPurchaseLines.filter((l) => targetIdxSet.has(monthIndexFromDateStr(l.purchase_date)));

  const actualByAccountMonth = new Map<string, number>();
  for (const line of actualLines) {
    const key = `${line.account_id}-${monthIndexFromDateStr(line.purchase_date)}`;
    actualByAccountMonth.set(key, (actualByAccountMonth.get(key) ?? 0) + line.value_eur);
  }
  // Ne garder que les mois réellement commandés (CA > 0) comme vérité terrain.
  for (const [key, ca] of actualByAccountMonth) if (ca <= 0) actualByAccountMonth.delete(key);

  const knownSales = aggregateToMonthlySales(knownLines);
  const backtestAccounts = asOfCutoffAccounts(accounts, knownLines);

  const withProductSignal = runVariant(
    "Avec signal produit",
    backtestAccounts,
    knownSales,
    knownLines,
    targetMonths,
    actualByAccountMonth
  );
  const withoutProductSignal = runVariant(
    "Sans signal produit (comportement précédent)",
    backtestAccounts,
    knownSales,
    [],
    targetMonths,
    actualByAccountMonth
  );

  return {
    cutoff: { year: cutoffYear, month: cutoffMonth },
    targetMonths,
    withProductSignal,
    withoutProductSignal,
  };
}

// ── Backtest par référence ────────────────────────────────────────────────
// Le backtest ci-dessus mesure "commande ce mois-ci, n'importe quelle
// marque" — utile pour juger l'impact global sur le générateur Pilotage,
// mais ça masque le fait que le signal produit marche sûrement mieux sur
// certaines références que d'autres (plus d'historique, cadence plus
// régulière). Cette fonction descend au niveau compte × marque, sur
// `sonarscore/prediction.ts` directement, et sort une ligne par référence
// filler — y compris celles sans donnée exploitable sur la fenêtre testée,
// pour que "pas assez d'historique" reste visible plutôt que silencieux.

export interface BrandBacktestResult {
  brand: string;
  category: BrandCategory;
  predictedCount: number;
  hits: number;
  precision: number | null;
  actualOrderCount: number;
  recall: number | null;
  f1: number | null;
}

export interface BrandBacktestReport {
  cutoff: { year: number; month: number };
  targetMonths: { year: number; month: number }[];
  brands: BrandBacktestResult[];
}

/**
 * Même principe de rejeu que `runForecastBacktest`, mais décomposé référence
 * par référence : pour chaque marque, "prévu" = une prédiction compte ×
 * marque de `predictNextOrders` dont la date attendue tombe dans la fenêtre
 * testée ; "succès" = cette marque précise a bien été rachetée par ce
 * compte précis ce mois-là.
 *
 * Couvre toutes les marques présentes dans les données (fillers ET le
 * reste — dermo-cosmétique réelle, mais aussi lignes non commerciales du
 * type bandeau/carte implant si elles remontent comme "marque" à l'import) :
 * utile pour vérifier que ces dernières se comportent bien comme prévu
 * (précision/rappel proches de zéro, faute de vrai rythme de réachat), ce
 * qui confirme après coup qu'elles ont eu raison d'être exclues des modèles
 * persona (lib/brands.ts). Les 12 fillers connus (`FILLER_BRANDS`) sont
 * toujours listés, même sans donnée sur la fenêtre testée ; les autres
 * marques n'apparaissent que si elles ont un signal réel (prévu ou acheté).
 */
export function runBrandBacktest(
  allPurchaseLines: BacktestPurchaseLine[],
  cutoffYear: number,
  cutoffMonth: number,
  horizonMonths = 3
): BrandBacktestReport {
  const cutoffIdx = monthIndex(cutoffYear, cutoffMonth);
  const targetMonths = nextMonthsFrom(cutoffYear, cutoffMonth, horizonMonths);
  const targetIdxSet = new Set(targetMonths.map((m) => monthIndex(m.year, m.month)));

  const knownLines = allPurchaseLines.filter((l) => monthIndexFromDateStr(l.purchase_date) < cutoffIdx);
  const actualLines = allPurchaseLines.filter((l) => targetIdxSet.has(monthIndexFromDateStr(l.purchase_date)));

  // Vérité terrain : quels comptes ont réellement racheté quelle marque, à
  // quel mois, dans la fenêtre testée.
  const actualByBrand = new Map<string, Set<string>>(); // brand -> set("accountId|monthIdx")
  for (const line of actualLines) {
    const set = actualByBrand.get(line.brand) ?? new Set<string>();
    set.add(`${line.account_id}|${monthIndexFromDateStr(line.purchase_date)}`);
    actualByBrand.set(line.brand, set);
  }

  const velocities = computeBrandVelocities(knownLines);
  const predictions = predictNextOrders(knownLines, velocities);
  const relevantPredictionsByBrand = new Map<string, { accountId: string; monthIdx: number }[]>();
  for (const p of predictions) {
    if (!p.expectedNextOrderDate) continue;
    const idx = monthIndexFromDateStr(p.expectedNextOrderDate);
    if (!targetIdxSet.has(idx)) continue;
    const arr = relevantPredictionsByBrand.get(p.brand) ?? [];
    arr.push({ accountId: p.accountId, monthIdx: idx });
    relevantPredictionsByBrand.set(p.brand, arr);
  }

  // Univers des marques à afficher : les fillers connus (toujours, même à
  // vide) + toute autre marque ayant un signal réel sur les données connues
  // ou réalisées (sinon la liste serait infinie / bruitée par des libellés
  // à occurrence unique sans aucun intérêt).
  const otherBrandsWithSignal = new Set<string>();
  for (const l of knownLines) if (!FILLER_BRANDS.has(l.brand)) otherBrandsWithSignal.add(l.brand);
  for (const l of actualLines) if (!FILLER_BRANDS.has(l.brand)) otherBrandsWithSignal.add(l.brand);
  const brandUniverse = [...FILLER_BRANDS, ...otherBrandsWithSignal];

  const brands: BrandBacktestResult[] = brandUniverse
    .map((brand) => {
      const preds = relevantPredictionsByBrand.get(brand) ?? [];
      const actualSet = actualByBrand.get(brand) ?? new Set<string>();
      const hits = preds.filter((p) => actualSet.has(`${p.accountId}|${p.monthIdx}`)).length;
      const precision = preds.length > 0 ? hits / preds.length : null;
      const actualOrderCount = actualSet.size;
      const recall = actualOrderCount > 0 ? hits / actualOrderCount : null;
      const f1 =
        precision !== null && recall !== null && precision + recall > 0
          ? (2 * precision * recall) / (precision + recall)
          : null;
      return {
        brand,
        category: brandCategory(brand),
        predictedCount: preds.length,
        hits,
        precision,
        actualOrderCount,
        recall,
        f1,
      };
    })
    // Fillers d'abord (référentiel connu et stable), puis le reste — dans
    // chaque groupe, les références avec le plus de signal en premier.
    .sort((a, b) => {
      if (a.category !== b.category) return a.category === "filler" ? -1 : 1;
      return b.predictedCount + b.actualOrderCount - (a.predictedCount + a.actualOrderCount);
    });

  return { cutoff: { year: cutoffYear, month: cutoffMonth }, targetMonths, brands };
}
