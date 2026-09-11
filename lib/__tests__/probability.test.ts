import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildExamples, buildProbabilityModel, CRITERIA } from "@/lib/probability";
import type { SaleRow } from "@/lib/probability";
import { monthIndex } from "@/lib/dates";
import type { Account } from "@/types/database";

const compte = (id: string, patch: Partial<Account> = {}): Account =>
  ({ id, name: `Compte ${id}`, segment: "B", status: "actif", price_list: "Pro", ...patch }) as Account;

/** Ventes mensuelles d'un compte, à partir d'une liste d'index absolus. */
const ventes = (id: string, mois: number[], ca = 1000): SaleRow[] =>
  mois.map((idx) => {
    const year = Math.floor((idx - 1) / 12);
    const month = ((idx - 1) % 12) + 1;
    return { account_id: id, year, month, ca };
  });

const M = (year: number, month: number) => monthIndex(year, month);
const AS_OF = { year: 2026, month: 9 };

/** Tous les mois de [from, to]. */
const chaqueMois = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** Un mois sur `pas` dans [from, to]. */
const tousLes = (pas: number, from: number, to: number) => chaqueMois(from, to).filter((m) => (m - from) % pas === 0);

/**
 * Portefeuille synthétique avec un vrai signal : des comptes métronomes, des
 * comptes trimestriels, des comptes décrochés, des prospects — sur 30 mois.
 */
function portefeuille() {
  const debut = M(2024, 1);
  const fin = M(2026, 8);
  const accounts: Account[] = [];
  const sales: SaleRow[] = [];
  for (let i = 0; i < 12; i++) {
    accounts.push(compte(`mensuel-${i}`, { segment: "A" }));
    sales.push(...ventes(`mensuel-${i}`, chaqueMois(debut, fin), 2000));
  }
  for (let i = 0; i < 12; i++) {
    accounts.push(compte(`trim-${i}`, { segment: "B" }));
    sales.push(...ventes(`trim-${i}`, tousLes(3, debut + (i % 3), fin), 3000));
  }
  for (let i = 0; i < 8; i++) {
    // Actifs jusqu'à mi-2025, plus rien depuis.
    accounts.push(compte(`decroche-${i}`, { segment: "C" }));
    sales.push(...ventes(`decroche-${i}`, chaqueMois(debut, M(2025, 6)), 1500));
  }
  for (let i = 0; i < 10; i++) accounts.push(compte(`prospect-${i}`, { segment: "D", price_list: null }));
  return { accounts, sales };
}

describe("buildExamples", () => {
  test("étiquette avec les seuls mois qui suivent le mois de référence", () => {
    // La fenêtre de données commence au premier mois de vente (février).
    const sales = ventes("A", [M(2026, 2), M(2026, 5)]);
    const { examples } = buildExamples({
      accounts: [compte("A")],
      monthlySales: sales,
      horizon: 3,
      asOf: AS_OF,
    });
    const at = (y: number, m: number) => examples.find((e) => e.t === M(y, m))!;
    assert.equal(at(2026, 2).ordered, true, "mai tombe dans (févr, mai] — février lui-même ne compte pas");
    assert.equal(at(2026, 3).ordered, true);
    assert.equal(at(2026, 4).ordered, true);
    assert.equal(at(2026, 5).ordered, false, "rien après mai");
    assert.equal(at(2026, 2).features.cadence, "Unique", "en février, une seule commande connue");
  });

  test("n'utilise jamais une commande future dans les critères", () => {
    // Une seule commande, en mai 2026. En mars 2026 le compte doit être vu
    // comme n'ayant JAMAIS commandé — le modèle ne connaît pas encore mai.
    // Un autre compte ouvre la fenêtre de données dès janvier.
    const sales = [...ventes("A", [M(2026, 5)]), ...ventes("Z", [M(2026, 1)])];
    const { examples } = buildExamples({
      accounts: [compte("A"), compte("Z")],
      monthlySales: sales,
      horizon: 1,
      asOf: AS_OF,
    });
    const mars = examples.find((e) => e.accountId === "A" && e.t === M(2026, 3))!;
    assert.equal(mars.features.cadence, "Jamais");
    assert.equal(mars.features.retard, "jamais");
    assert.equal(mars.features.activite, "0");
    assert.equal(mars.ordered, false, "mai n'est pas dans (mars, avril]");
  });

  test("ne produit que des exemples dont l'issue est entièrement observable", () => {
    // Mois en cours partiel (septembre) : dernier mois complet = août. À
    // horizon 3, le dernier mois de référence exploitable est mai.
    const sales = ventes("A", chaqueMois(M(2025, 1), M(2026, 8)));
    const { examples } = buildExamples({ accounts: [compte("A")], monthlySales: sales, horizon: 3, asOf: AS_OF });
    assert.equal(Math.max(...examples.map((e) => e.t)), M(2026, 5));
  });

  test("qualifie la position dans le cycle selon la cadence du compte", () => {
    // Mensuel avec 2 mois de silence → « commande due » ; trimestriel avec le
    // même silence → encore « dans le cycle ».
    const mensuel = ventes("M", chaqueMois(M(2025, 1), M(2026, 3)));
    const trimestriel = ventes("T", tousLes(3, M(2025, 1), M(2026, 1)));
    const { examples } = buildExamples({
      accounts: [compte("M"), compte("T")],
      monthlySales: [...mensuel, ...trimestriel],
      horizon: 1,
      asOf: AS_OF,
    });
    const en = (id: string, y: number, m: number) => examples.find((e) => e.accountId === id && e.t === M(y, m))!;
    assert.equal(en("M", 2026, 3).features.retard, "debut_de_cycle", "vient de commander");
    assert.equal(en("M", 2026, 4).features.retard, "du");
    assert.equal(en("M", 2026, 5).features.retard, "en_retard");
    assert.equal(en("T", 2026, 2).features.retard, "debut_de_cycle", "1 mois sur un cycle de 3");
    assert.equal(en("T", 2026, 3).features.retard, "fin_de_cycle", "2 mois sur 3 : la prochaine est imminente");
    assert.equal(en("T", 2026, 4).features.retard, "du");
    assert.equal(en("T", 2026, 7).features.retard, "en_retard", "6 mois, deux cycles complets");
  });

  test("détecte la saisonnalité sur les mêmes mois de l'année précédente", () => {
    // Un compte d'ancrage ouvre la fenêtre dès janvier 2025, sinon
    // « ne commandait pas à cette période » serait indécidable.
    const sales = [...ventes("S", [M(2025, 6), M(2025, 7)]), ...ventes("Z", [M(2025, 1)])];
    const { examples } = buildExamples({
      accounts: [compte("S"), compte("Z")],
      monthlySales: sales,
      horizon: 3,
      asOf: AS_OF,
    });
    const en = (y: number, m: number) => examples.find((e) => e.accountId === "S" && e.t === M(y, m))!;
    assert.equal(en(2026, 5).features.saison, "oui", "juin–juillet 2025 ⊂ (mai, août] − 12 mois");
    assert.equal(en(2026, 1).features.saison, "non");
    assert.equal(en(2025, 3).features.saison, "sans_historique", "moins d'un an de données avant mars 2025");
  });

  test("marque l'absence de détail produit plutôt que de l'inventer", () => {
    const sales = ventes("A", chaqueMois(M(2025, 1), M(2026, 6)));
    const { examples } = buildExamples({ accounts: [compte("A")], monthlySales: sales, horizon: 3, asOf: AS_OF });
    assert.ok(examples.every((e) => e.features.produit === "sans_donnees"));
  });

  test("couvre tous les critères déclarés", () => {
    const sales = ventes("A", [M(2026, 1)]);
    const { examples } = buildExamples({ accounts: [compte("A")], monthlySales: sales, horizon: 1, asOf: AS_OF });
    for (const c of CRITERIA) {
      const valeurs = new Set(c.levels.map((l) => l.value));
      for (const e of examples) assert.ok(valeurs.has(e.features[c.key]), `${c.key} = ${e.features[c.key]} inconnu`);
    }
  });
});

describe("buildProbabilityModel", () => {
  const { accounts, sales } = portefeuille();
  const model = buildProbabilityModel({ accounts, monthlySales: sales, horizon: 3, asOf: AS_OF });
  const proba = (id: string) => model.accounts.find((a) => a.accountId === id)!.probability;

  test("classe les comptes dans l'ordre attendu", () => {
    // À horizon 3, un trimestriel commande à coup sûr dans la fenêtre :
    // il rejoint le métronome. C'est à horizon 1 que la cadence les sépare.
    // trim-1 a commandé en août : prochaine échéance en novembre, hors d'un
    // horizon d'un mois. trim-0 a commandé en juillet : octobre est imminent.
    const h1 = buildProbabilityModel({ accounts, monthlySales: sales, horizon: 1, asOf: AS_OF });
    const p1 = (id: string) => h1.accounts.find((a) => a.accountId === id)!.probability;
    assert.ok(p1("mensuel-0") > p1("trim-1") + 0.3, `métronome ${p1("mensuel-0")} ≫ trimestriel en début de cycle ${p1("trim-1")}`);
    assert.ok(p1("trim-0") > p1("trim-1") + 0.3, `fin de cycle ${p1("trim-0")} ≫ début de cycle ${p1("trim-1")}`);

    assert.ok(proba("trim-0") > 0.85, "à trois mois, un trimestriel régulier est quasi certain");
    assert.ok(proba("trim-0") > proba("decroche-0") + 0.4, "actif ≫ décroché");
    assert.ok(proba("decroche-0") < 0.4, `un compte muet depuis 14 mois : ${proba("decroche-0")}`);
    assert.ok(proba("decroche-0") >= proba("prospect-0") - 0.05, "décroché ≥ prospect (à la marge près)");
  });

  test("donne des probabilités bornées et cohérentes avec les fréquences observées", () => {
    for (const a of model.accounts) assert.ok(a.probability > 0 && a.probability < 1);
    assert.ok(proba("mensuel-0") > 0.85, `un métronome sans faille doit être très probable (${proba("mensuel-0")})`);
    assert.ok(proba("prospect-0") < 0.25, `un prospect sans historique reste improbable (${proba("prospect-0")})`);
  });

  test("les taux par critère reflètent la population", () => {
    const cadence = model.criteria.find((c) => c.key === "cadence")!;
    const mensuelle = cadence.levels.find((l) => l.value === "Mensuelle")!;
    const jamais = cadence.levels.find((l) => l.value === "Jamais")!;
    // « Mensuelle » inclut les comptes décrochés (leur cadence passée reste
    // mensuelle) : élevé, mais pas 100 %.
    assert.ok(mensuelle.rate > 0.75 && mensuelle.rate < 0.95, `taux mensuelle ${mensuelle.rate}`);
    // « Jamais commandé » couvre les prospects (jamais convertis) ET les
    // premiers mois des comptes trimestriels décalés, qui commandent juste
    // après : un taux faible, pas nul.
    assert.ok(jamais.rate < 0.25, `taux « jamais » ${jamais.rate}`);
    assert.ok(mensuelle.n > 0 && jamais.n > 0);

    // C'est la position dans le cycle qui sépare vraiment les issues.
    const retard = model.criteria.find((c) => c.key === "retard")!;
    const rate = (v: string) => retard.levels.find((l) => l.value === v)?.rate ?? NaN;
    assert.ok(rate("debut_de_cycle") > 0.9, `début de cycle ${rate("debut_de_cycle")}`);
    assert.ok(rate("decroche") < 0.1, `décroché ${rate("decroche")}`);
  });

  test("bat le taux de base sur la fenêtre d'évaluation", () => {
    const { brier, brierBase, auc, n } = model.evaluation;
    assert.ok(n > 0);
    assert.ok(brier !== null && brierBase !== null && brier < brierBase, `Brier ${brier} vs base ${brierBase}`);
    assert.ok(auc !== null && auc > 0.95, `AUC ${auc}`);
  });

  test("la table de fiabilité totalise les exemples évalués", () => {
    const total = model.evaluation.reliability.reduce((s, b) => s + b.n, 0);
    assert.equal(total, model.evaluation.n);
    for (const b of model.evaluation.reliability) {
      if (b.n === 0) continue;
      assert.ok(b.predicted >= b.from - 1e-9 && b.predicted <= b.to + 1e-9);
      assert.ok(b.observed >= 0 && b.observed <= 1);
    }
  });

  test("apprend sur des mois strictement antérieurs à la fenêtre d'évaluation", () => {
    assert.ok(model.trainingSize < model.sampleSize);
    assert.equal(model.trainingSize + model.evaluation.n, model.sampleSize);
  });

  test("les facteurs sont triés par influence et renvoient à un taux observé", () => {
    const a = model.accounts.find((x) => x.accountId === "mensuel-0")!;
    for (let i = 1; i < a.factors.length; i++) {
      assert.ok(Math.abs(a.factors[i - 1].weight) >= Math.abs(a.factors[i].weight));
    }
    const cadence = a.factors.find((f) => f.key === "cadence")!;
    assert.equal(cadence.level, "Mensuelle");
    assert.ok(cadence.rate > 0.75);
    const decroche = model.accounts.find((x) => x.accountId === "decroche-0")!;
    const retard = decroche.factors.find((f) => f.key === "retard")!;
    assert.equal(retard.level, "decroche");
    assert.ok(retard.weight < 0, "décroché : facteur défavorable");
  });

  test("estime un CA attendu proportionnel à la probabilité et à la cadence", () => {
    const mensuel = model.accounts.find((x) => x.accountId === "mensuel-0")!;
    const trim = model.accounts.find((x) => x.accountId === "trim-0")!;
    assert.equal(mensuel.typicalOrderCa, 2000);
    assert.equal(mensuel.expectedOrdersIfActive, 3, "3 commandes mensuelles attendues sur 3 mois");
    assert.equal(trim.expectedOrdersIfActive, 1);
    assert.ok(mensuel.expectedCa > trim.expectedCa);
    const prospect = model.accounts.find((x) => x.accountId === "prospect-0")!;
    assert.equal(prospect.expectedCa, 0, "sans commande type, pas de CA attendu");
  });

  test("le nombre de comptes attendus en commande est la somme des probabilités", () => {
    const somme = model.accounts.reduce((s, a) => s + a.probability, 0);
    assert.ok(Math.abs(somme - model.expectedOrderingAccounts) < 1e-9);
    assert.ok(somme > 12 && somme < accounts.length);
  });

  test("reste utilisable avec très peu d'historique", () => {
    const petit = buildProbabilityModel({
      accounts: [compte("A"), compte("B")],
      monthlySales: ventes("A", [M(2026, 6), M(2026, 7)]),
      horizon: 1,
      asOf: AS_OF,
    });
    assert.equal(petit.accounts.length, 2);
    for (const a of petit.accounts) assert.ok(a.probability > 0 && a.probability < 1);
    assert.equal(petit.evaluation.calibrated, false, "pas assez d'exemples pour recalibrer");
  });

  test("sans aucune vente, ne plante pas et renvoie des probabilités neutres", () => {
    const vide = buildProbabilityModel({ accounts: [compte("A")], monthlySales: [], horizon: 3, asOf: AS_OF });
    assert.equal(vide.sampleSize, 0);
    assert.equal(vide.accounts.length, 1);
    assert.ok(vide.accounts[0].probability > 0);
  });
});

describe("signal produit", () => {
  test("une référence attendue dans l'horizon vaut « oui », sinon « non »", () => {
    // Commande produit tous les 60 jours ; en juin, la prochaine est
    // attendue début août → « oui » à horizon 3, « non » à horizon 1.
    const lignes = ["2026-01-05", "2026-03-06", "2026-05-05"].map((d) => ({
      account_id: "P",
      brand: "RHA 2",
      purchase_date: d,
      qty: 4,
    }));
    const sales = ventes("P", [M(2026, 1), M(2026, 3), M(2026, 5)]);
    const h3 = buildExamples({ accounts: [compte("P")], monthlySales: sales, purchaseLines: lignes, horizon: 3, asOf: AS_OF });
    const h1 = buildExamples({ accounts: [compte("P")], monthlySales: sales, purchaseLines: lignes, horizon: 1, asOf: AS_OF });
    const juin3 = h3.examples.find((e) => e.t === M(2026, 5))!;
    const juin1 = h1.examples.find((e) => e.t === M(2026, 5))!;
    assert.equal(juin3.features.produit, "oui");
    assert.equal(juin1.features.produit, "non");
  });

  test("n'utilise que les lignes connues au mois de référence", () => {
    // En février, seul l'achat de janvier est connu : une seule ligne, pas
    // de rythme propre, pas de vélocité de marque → aucune attente.
    const lignes = ["2026-01-05", "2026-03-06", "2026-05-05"].map((d) => ({
      account_id: "P",
      brand: "RHA 2",
      purchase_date: d,
      qty: 4,
    }));
    const sales = ventes("P", [M(2026, 1), M(2026, 3), M(2026, 5)]);
    const { examples } = buildExamples({ accounts: [compte("P")], monthlySales: sales, purchaseLines: lignes, horizon: 3, asOf: AS_OF });
    assert.equal(examples.find((e) => e.t === M(2026, 2))!.features.produit, "non");
  });
});
