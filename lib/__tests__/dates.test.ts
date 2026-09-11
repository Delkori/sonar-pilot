import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  daysSince,
  fromMonthIndex,
  monthIndex,
  monthIndexFromDateStr,
  monthLong,
  monthShort,
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
