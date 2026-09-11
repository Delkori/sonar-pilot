import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ACTION_META, computeTargetingScore, NB_REFS_FILLERS, prixBoiteHT } from "@/lib/scoring";
import { DAY_MS } from "@/lib/dates";
import type { Account } from "@/types/database";

const ilYA = (jours: number) => new Date(Date.now() - jours * DAY_MS).toISOString().slice(0, 10);

const compte = (patch: Partial<Account> = {}): Account =>
  ({
    id: "x",
    segment: "C",
    status: "actif",
    price_list: null,
    last_order_date: ilYA(10),
    jours_silence: null,
    potentiel_boites: 0,
    ca_2024: 0,
    ca_2025: 0,
    ca_2026_ytd: 0,
    nb_refs_achetees_2025: null,
    refs_manquantes: null,
    ...patch,
  }) as Account;

describe("prixBoiteHT", () => {
  test("applique la remise du tier de contrat", () => {
    // Un Pro+ (50 % de remise) paie forcément moins qu'un Premium (41 %).
    assert.ok(prixBoiteHT("Pro+") < prixBoiteHT("Pro"));
    assert.ok(prixBoiteHT("Pro") < prixBoiteHT("Premium"));
  });

  test("retombe sur la remise moyenne si le tier est inconnu", () => {
    const defaut = prixBoiteHT(null);
    assert.ok(defaut > prixBoiteHT("Pro+") && defaut < prixBoiteHT("Premium"));
    assert.equal(prixBoiteHT("tier inexistant"), defaut);
  });
});

describe("computeTargetingScore", () => {
  test("le barème plafonne à 100 points", () => {
    const total = computeTargetingScore(compte()).criteria.reduce((s, c) => s + c.max, 0);
    assert.equal(total, 100);
  });

  test("le score reste dans les bornes et égale la somme des critères", () => {
    const score = computeTargetingScore(
      compte({ segment: "A", last_order_date: ilYA(400), potentiel_boites: 900, ca_2024: 40000 })
    );
    assert.equal(score.total, score.criteria.reduce((s, c) => s + c.points, 0));
    assert.ok(score.total >= 0 && score.total <= 100);
    assert.ok(score.criteria.every((c) => c.points <= c.max));
  });

  test("un silence plus long ne fait jamais baisser le score", () => {
    const court = computeTargetingScore(compte({ last_order_date: ilYA(7) })).total;
    const long = computeTargetingScore(compte({ last_order_date: ilYA(200) })).total;
    assert.ok(long > court);
  });

  test("se replie sur jours_silence quand la date de commande manque", () => {
    const score = computeTargetingScore(compte({ last_order_date: null, jours_silence: 140 }));
    assert.equal(score.silenceSemaines, 20);
  });

  test("signale un silence inconnu plutôt que de le supposer nul", () => {
    const score = computeTargetingScore(compte({ last_order_date: null, jours_silence: null }));
    assert.equal(score.silenceSemaines, null);
  });

  test("le CA non capté ne devient jamais négatif", () => {
    // Compte qui dépasse son potentiel estimé : l'écart est nul, pas négatif.
    const score = computeTargetingScore(compte({ potentiel_boites: 10, ca_2025: 500000 }));
    assert.equal(score.caNonCapte, 0);
  });

  test("compte les références manquantes à partir des achats réels", () => {
    const score = computeTargetingScore(compte(), { refsAcheteesCount: 3 });
    assert.equal(score.refsManquantes, NB_REFS_FILLERS - 3);
  });

  test("un compte actif en 2024 sans CA 2025 part en reconquête", () => {
    const score = computeTargetingScore(
      compte({ segment: "D", ca_2024: 9000, ca_2025: 0, potentiel_boites: 20, last_order_date: ilYA(30) })
    );
    assert.ok(score.total < 70, "sinon la règle « visite urgente » prendrait le dessus");
    assert.equal(score.action, "reconquete");
  });

  test("un score très élevé déclenche la visite urgente", () => {
    const score = computeTargetingScore(
      compte({ segment: "A", last_order_date: ilYA(400), potentiel_boites: 2000, ca_2024: 60000, ca_2025: 100 })
    );
    assert.ok(score.total >= 70);
    assert.equal(score.action, "visite_urgente");
  });

  test("toute action renvoyée possède un libellé", () => {
    const score = computeTargetingScore(compte());
    assert.ok(ACTION_META[score.action]);
  });
});

describe("années de référence", () => {
  test("suit le changement d'année sans intervention", () => {
    // Le barème comparait 2024 à 2025 en dur : en 2027, il aurait encore
    // jugé les comptes sur des exercices vieux de trois ans.
    const en2026 = computeTargetingScore(compte(), { now: new Date(2026, 5, 1) });
    const en2028 = computeTargetingScore(compte(), { now: new Date(2028, 5, 1) });
    assert.equal(en2026.criteria.find((c) => c.key === "evolution")!.label, "Évolution 24→25");
    assert.equal(en2028.criteria.find((c) => c.key === "evolution")!.label, "Évolution 26→27");
  });

  test("nomme l'exercice dans le détail du CA non capté", () => {
    const score = computeTargetingScore(compte({ potentiel_boites: 100 }), { now: new Date(2029, 0, 1) });
    assert.match(score.criteria.find((c) => c.key === "ca_non_capte")!.detail, /CA 2028/);
  });

  test("lit le CA des ventes mensuelles pour une année sans colonne dédiée", () => {
    // 2027 n'a pas de colonne `ca_2027` et n'en aura jamais : le chiffre doit
    // venir des ventes mensuelles réelles.
    const caParAnnee = new Map([["x|2027", 50000]]);
    const score = computeTargetingScore(compte({ potentiel_boites: 1000, ca_2025: 0 }), {
      now: new Date(2028, 5, 1),
      caByAccountYear: caParAnnee,
    });
    assert.ok(score.penetration !== null && score.penetration > 0, "le CA 2027 doit être pris en compte");
  });

  test("détecte une reconquête sur les exercices courants, pas sur 2024/2025", () => {
    const caParAnnee = new Map([["x|2027", 30000]]); // actif en N-2, rien en N-1
    const score = computeTargetingScore(
      compte({ segment: "D", potentiel_boites: 20, last_order_date: ilYA(30) }),
      { now: new Date(2029, 5, 1), caByAccountYear: caParAnnee }
    );
    assert.equal(score.action, "reconquete");
    assert.match(score.criteria.find((c) => c.key === "evolution")!.detail, /Actif en 2027, aucun CA 2028/);
  });

  test("sans ventes mensuelles, se replie sur les colonnes héritées", () => {
    // Comportement inchangé pour les exercices qui possèdent une colonne :
    // c'est ce qui garantit qu'aucun score ne bouge aujourd'hui.
    const avecColonnes = computeTargetingScore(compte({ ca_2024: 30000, ca_2025: 0, potentiel_boites: 50 }), {
      now: new Date(2026, 5, 1),
    });
    assert.match(avecColonnes.criteria.find((c) => c.key === "evolution")!.detail, /Actif en 2024, aucun CA 2025/);
  });
});
