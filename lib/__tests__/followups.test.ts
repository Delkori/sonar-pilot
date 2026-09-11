import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nextWeekdays } from "@/lib/followups";

describe("nextWeekdays", () => {
  test("ne renvoie que des jours ouvrés", () => {
    // Régression : les dates étaient produites via toISOString(), qui en
    // heure d'été renvoie la veille — un lundi ressortait daté du dimanche,
    // puis écarté en aval comme jour non ouvré.
    for (const jour of nextWeekdays(10)) {
      const jourSemaine = new Date(`${jour}T12:00:00`).getDay();
      assert.ok(jourSemaine >= 1 && jourSemaine <= 5, `${jour} tombe un week-end`);
    }
  });

  test("renvoie exactement le nombre demandé, en ordre croissant", () => {
    const jours = nextWeekdays(7);
    assert.equal(jours.length, 7);
    assert.deepEqual(jours, [...jours].sort());
    assert.equal(new Set(jours).size, 7);
  });

  test("commence après aujourd'hui", () => {
    const aujourdhui = new Date();
    const attendu = `${aujourdhui.getFullYear()}-${String(aujourdhui.getMonth() + 1).padStart(2, "0")}-${String(aujourdhui.getDate()).padStart(2, "0")}`;
    assert.ok(nextWeekdays(1)[0] > attendu);
  });
});
