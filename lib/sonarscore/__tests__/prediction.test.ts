import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { forecastForPeriod, predictNextOrders } from "@/lib/sonarscore/prediction";
import { computeBrandVelocities } from "@/lib/sonarscore/velocity";
import type { BrandVelocity, PurchaseLine } from "@/lib/sonarscore/velocity";

const l = (account_id: string, brand: string, purchase_date: string, qty = 10): PurchaseLine => ({
  account_id,
  brand,
  purchase_date,
  qty,
});

/** Vélocité de marque suffisamment étayée pour servir de repli. */
const velociteSolide = (brand: string, medianDays: number): Map<string, BrandVelocity> =>
  new Map([[brand, { brand, medianDays, sampleSize: 12, accountsWithRepeatPurchase: 6 }]]);

describe("predictNextOrders", () => {
  test("utilise le rythme propre au compte dès deux achats", () => {
    const lines = [l("A", "RHA 2", "2026-01-10"), l("A", "RHA 2", "2026-03-11")];
    const [p] = predictNextOrders(lines, new Map());
    assert.equal(p.confidence, "compte");
    assert.equal(p.intervalUsedDays, 60);
    assert.equal(p.expectedNextOrderDate, "2026-05-10");
  });

  test("prend la médiane des intervalles, pas le dernier", () => {
    // Un intervalle aberrant ne doit pas emporter la prédiction.
    const lines = [
      l("A", "RHA 2", "2026-01-01"),
      l("A", "RHA 2", "2026-02-01"), // 31 j
      l("A", "RHA 2", "2026-03-01"), // 28 j
      l("A", "RHA 2", "2026-09-01"), // 184 j — exceptionnel
    ];
    const [p] = predictNextOrders(lines, new Map());
    assert.equal(p.intervalUsedDays, 31);
  });

  test("se replie sur la vélocité de marque pour un essai unique", () => {
    const [p] = predictNextOrders([l("A", "Kiss", "2026-02-01")], velociteSolide("Kiss", 90));
    assert.equal(p.confidence, "marque");
    assert.equal(p.expectedNextOrderDate, "2026-05-02");
  });

  test("refuse de prédire quand la marque est trop peu documentée", () => {
    // Moins de 5 comptes récurrents : la médiane de population ne veut rien
    // dire, mieux vaut aucune date qu'une date inventée.
    const fragile = new Map([
      ["Kiss", { brand: "Kiss", medianDays: 90, sampleSize: 2, accountsWithRepeatPurchase: 2 }],
    ]);
    const [p] = predictNextOrders([l("A", "Kiss", "2026-02-01")], fragile);
    assert.equal(p.confidence, "insuffisante");
    assert.equal(p.expectedNextOrderDate, null);
    assert.equal(p.expectedQty, null);
  });

  test("sépare les marques d'un même compte", () => {
    const lines = [
      l("A", "RHA 2", "2026-01-01"),
      l("A", "RHA 2", "2026-02-01"),
      l("A", "Kiss", "2026-01-15"),
      l("A", "Kiss", "2026-04-15"),
    ];
    const preds = predictNextOrders(lines, new Map());
    assert.equal(preds.length, 2);
    assert.deepEqual(preds.map((p) => p.brand).sort(), ["Kiss", "RHA 2"]);
  });
});

describe("computeBrandVelocities", () => {
  test("n'utilise que les comptes ayant racheté", () => {
    const lines = [
      l("A", "RHA 2", "2026-01-01"),
      l("A", "RHA 2", "2026-02-01"), // 31 j
      l("B", "RHA 2", "2026-01-01"),
      l("B", "RHA 2", "2026-02-10"), // 40 j
      l("C", "RHA 2", "2026-03-01"), // essai unique : ignoré
    ];
    const v = computeBrandVelocities(lines).get("RHA 2")!;
    assert.equal(v.accountsWithRepeatPurchase, 2);
    assert.equal(v.sampleSize, 2);
    assert.equal(v.medianDays, 35.5);
  });

  test("ignore les marques sans aucun rachat", () => {
    assert.equal(computeBrandVelocities([l("A", "Kiss", "2026-01-01")]).size, 0);
  });
});

describe("forecastForPeriod", () => {
  test("ne retient que les commandes attendues dans la fenêtre", () => {
    const preds = predictNextOrders(
      [
        l("A", "RHA 2", "2026-05-01", 4),
        l("A", "RHA 2", "2026-06-30", 4), // ~60 j -> fin août, dans le Q3
        l("B", "Kiss", "2026-01-01", 9),
        l("B", "Kiss", "2026-02-01", 9), // ~31 j -> mars, hors Q3
      ],
      new Map()
    );
    const q3 = forecastForPeriod(preds, "2026-07-01", "2026-09-30");
    assert.deepEqual(q3.map((f) => f.accountId), ["A"]);
    assert.equal(q3[0].totalExpectedQty, 4);
  });

  test("écarte les prédictions sans date", () => {
    const preds = predictNextOrders([l("A", "Kiss", "2026-08-01")], new Map());
    assert.equal(preds[0].confidence, "insuffisante");
    assert.deepEqual(forecastForPeriod(preds, "2026-07-01", "2026-09-30"), []);
  });
});
