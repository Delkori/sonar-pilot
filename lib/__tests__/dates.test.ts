import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  currentMonthIndex,
  daysBetween,
  daysSince,
  fromMonthIndex,
  monthIndex,
  monthIndexFromDateStr,
  monthLong,
  monthShort,
  monthsFrom,
  quarterOf,
  quarterStartIndex,
  quarterStartMonth,
  toDateStr,
  weeksSince,
  DAY_MS,
} from "@/lib/dates";

// La suite tourne en Europe/Paris (voir le script `test` de package.json) :
// c'est le fuseau du secteur, et c'est celui sous lequel le bug d'heure
// d'été corrigé ici se manifeste.

describe("toDateStr", () => {
  test("formate en heure locale, pas en UTC", () => {
    // 29 mars 2026 est le passage à l'heure d'été en France. À minuit local,
    // il est encore 23:00 UTC la veille : `toISOString().slice(0, 10)` rend
    // donc le 28 — c'est exactement le bug qui décalait les jours ouvrés.
    const minuitLocal = new Date(2026, 2, 29, 0, 0, 0);
    assert.equal(toDateStr(minuitLocal), "2026-03-29");

    // La divergence avec toISOString() n'apparaît qu'à l'est de Greenwich.
    // Le script `test` fixe TZ=Europe/Paris ; sous un autre fuseau, on
    // vérifie seulement l'invariant ci-dessus plutôt que d'échouer à tort.
    if (minuitLocal.getTimezoneOffset() < 0) {
      assert.notEqual(
        minuitLocal.toISOString().slice(0, 10),
        "2026-03-29",
        "c'est précisément ce décalage que toDateStr corrige"
      );
    }
  });

  test("complète les mois et jours à deux chiffres", () => {
    assert.equal(toDateStr(new Date(2026, 0, 5)), "2026-01-05");
  });
});

describe("addDays", () => {
  test("traverse un changement d'heure sans perdre de jour", () => {
    assert.equal(addDays("2026-03-28", 2), "2026-03-30");
    assert.equal(addDays("2026-10-24", 2), "2026-10-26"); // retour heure d'hiver
  });

  test("accepte un décalage négatif et arrondit les fractions", () => {
    assert.equal(addDays("2026-05-10", -3), "2026-05-07");
    assert.equal(addDays("2026-05-10", 1.6), "2026-05-12");
  });
});

describe("daysSince / weeksSince", () => {
  test("renvoient null sans date", () => {
    assert.equal(daysSince(null), null);
    assert.equal(daysSince(undefined), null);
    assert.equal(weeksSince(null), null);
  });

  test("ne descendent jamais sous zéro pour une date future", () => {
    const demain = new Date(Date.now() + DAY_MS);
    assert.equal(daysSince(demain), 0);
    assert.equal(weeksSince(demain), 0);
  });

  test("comptent des jours entiers écoulés", () => {
    const asOf = new Date(2026, 5, 30, 12, 0, 0);
    assert.equal(daysSince(new Date(2026, 5, 10, 12, 0, 0), asOf), 20);
    assert.equal(weeksSince(new Date(2026, 5, 10, 12, 0, 0), asOf), 2);
  });
});

describe("daysBetween", () => {
  test("compte b − a, signe compris", () => {
    assert.equal(daysBetween("2026-01-01", "2026-01-31"), 30);
    assert.equal(daysBetween("2026-01-31", "2026-01-01"), -30);
    assert.equal(daysBetween("2026-02-10", "2026-02-10"), 0);
  });

  test("reste juste à travers un changement d'heure", () => {
    // Sans arrondi, cette plage fait 30,96 jours à cause de l'heure perdue.
    assert.equal(daysBetween("2026-03-15", "2026-04-15"), 31);
  });
});

describe("index de mois", () => {
  test("monthIndex est ordonné et continu d'une année sur l'autre", () => {
    assert.equal(monthIndex(2026, 1) - monthIndex(2025, 12), 1);
    assert.ok(monthIndex(2026, 3) > monthIndex(2026, 2));
  });

  test("fromMonthIndex est l'inverse exact de monthIndex", () => {
    for (const [y, m] of [[2024, 1], [2025, 6], [2026, 12]] as const) {
      assert.deepEqual(fromMonthIndex(monthIndex(y, m)), { year: y, month: m });
    }
  });

  test("monthIndexFromDateStr lit la chaîne sans passer par Date", () => {
    assert.equal(monthIndexFromDateStr("2026-07-15"), monthIndex(2026, 7));
  });
});

describe("libellés de mois", () => {
  test("sont indexés de 1 à 12", () => {
    assert.equal(monthShort(1), "Jan");
    assert.equal(monthShort(12), "Déc");
    assert.equal(monthLong(8), "Août");
  });

  test("renvoient une chaîne vide hors plage plutôt que undefined", () => {
    assert.equal(monthShort(0), "");
    assert.equal(monthLong(13), "");
  });
});

describe("monthsFrom", () => {
  test("produit des mois consécutifs à partir du point demandé", () => {
    assert.deepEqual(monthsFrom(monthIndex(2026, 11), 3), [
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
  });

  test("accepte un point de départ passé", () => {
    // Le pilotage doit pouvoir revenir sur un trimestre écoulé pour
    // confronter le prévisionnel au réalisé.
    assert.deepEqual(monthsFrom(monthIndex(2024, 2), 2), [
      { year: 2024, month: 2 },
      { year: 2024, month: 3 },
    ]);
  });

  test("reste cohérent sur un horizon qui couvre plusieurs années", () => {
    const suite = monthsFrom(monthIndex(2025, 6), 24);
    assert.equal(suite.length, 24);
    assert.deepEqual(suite.at(-1), { year: 2027, month: 5 });
    for (let i = 1; i < suite.length; i++) {
      const ecart = monthIndex(suite[i].year, suite[i].month) - monthIndex(suite[i - 1].year, suite[i - 1].month);
      assert.equal(ecart, 1);
    }
  });

  test("renvoie une liste vide pour un horizon nul ou négatif", () => {
    assert.deepEqual(monthsFrom(monthIndex(2026, 1), 0), []);
    assert.deepEqual(monthsFrom(monthIndex(2026, 1), -3), []);
  });

  test("currentMonthIndex situe bien le mois en cours", () => {
    const now = new Date(2026, 8, 11); // septembre 2026
    assert.equal(currentMonthIndex(now), monthIndex(2026, 9));
  });
});

describe("trimestre calendaire", () => {
  test("quarterOf : janvier-février-mars sont le premier trimestre, etc.", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(quarterOf),
      [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]
    );
  });

  test("quarterStartMonth renvoie janvier, avril, juillet ou octobre", () => {
    assert.equal(quarterStartMonth(1), 1);
    assert.equal(quarterStartMonth(3), 1);
    assert.equal(quarterStartMonth(4), 4);
    assert.equal(quarterStartMonth(9), 7);
    assert.equal(quarterStartMonth(12), 10);
  });

  test("quarterStartIndex fait retomber n'importe quel mois sur le début de son trimestre", () => {
    // Choisir mars, comme janvier ou février, ramène tous au même trimestre :
    // celui de janvier — la définition ne dépend pas du mois exact cliqué.
    const janvier = monthIndex(2026, 1);
    for (const m of [1, 2, 3]) assert.equal(quarterStartIndex(monthIndex(2026, m)), janvier);
    const octobre = monthIndex(2026, 10);
    for (const m of [10, 11, 12]) assert.equal(quarterStartIndex(monthIndex(2026, m)), octobre);
  });

  test("quarterStartIndex traverse correctement le changement d'année", () => {
    // Décembre 2025 et janvier 2026 sont dans des trimestres différents,
    // pas confondus par une arithmétique modulo mal recalée sur l'année.
    assert.equal(quarterStartIndex(monthIndex(2025, 12)), monthIndex(2025, 10));
    assert.equal(quarterStartIndex(monthIndex(2026, 1)), monthIndex(2026, 1));
  });
});
