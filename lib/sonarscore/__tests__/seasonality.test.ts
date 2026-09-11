import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeSeasonalAnniversaries, predictSeasonalOrders } from "@/lib/sonarscore/seasonality";
import { monthIndex } from "@/lib/dates";
import type { PurchaseLine } from "@/lib/sonarscore/velocity";

const l = (account_id: string, brand: string, purchase_date: string, qty = 10): PurchaseLine => ({
  account_id,
  brand,
  purchase_date,
  qty,
});

const marques = (map: Map<string, { brand: string }[]>, id: string) =>
  (map.get(id) ?? []).map((s) => s.brand).sort();

describe("computeSeasonalAnniversaries", () => {
  test("cumule les motifs de plusieurs marques sur un même compte", () => {
    // Régression : la boucle parcourt des clés `compte|marque` et écrasait
    // l'entrée du compte à chaque marque — toutes ses marques sauf une
    // disparaissaient du prévisionnel, sans erreur ni trace.
    const lines = [
      l("A", "RHA 2", "2024-03-12"),
      l("A", "RHA 2", "2025-03-20"),
      l("A", "Kiss", "2024-09-05"),
      l("A", "Kiss", "2025-09-11"),
    ];
    assert.deepEqual(marques(computeSeasonalAnniversaries(lines), "A"), ["Kiss", "RHA 2"]);
  });

  test("ne dépend pas de l'ordre dans lequel les lignes arrivent", () => {
    // Les achats sortent de la base triés par id, pas par date : l'ancre de
    // l'année (« le premier achat ») doit être choisie après tri explicite.
    const chronologique = [
      l("B", "RHA 4", "2024-03-04"),
      l("B", "RHA 4", "2024-11-18"),
      l("B", "RHA 4", "2025-03-09"),
      l("B", "RHA 4", "2025-11-22"),
    ];
    const melange = [chronologique[3], chronologique[0], chronologique[2], chronologique[1]];

    const mois = (lines: PurchaseLine[]) =>
      (computeSeasonalAnniversaries(lines).get("B") ?? []).map((s) => s.anniversaryMonth);

    assert.deepEqual(mois(chronologique), [3], "ancre = premier achat de l'année");
    assert.deepEqual(mois(melange), mois(chronologique));
  });

  test("exige deux années civiles distinctes", () => {
    const memeAnnee = [l("C", "RHA 1", "2025-04-02"), l("C", "RHA 1", "2025-04-25")];
    assert.equal(computeSeasonalAnniversaries(memeAnnee).size, 0);

    const deuxAnnees = [l("C", "RHA 1", "2024-04-02"), l("C", "RHA 1", "2025-04-25")];
    assert.equal(computeSeasonalAnniversaries(deuxAnnees).get("C")?.[0].yearsObserved, 2);
  });

  test("regroupe les mois voisins en un seul motif, pas un par mois", () => {
    // Mars puis avril d'une année sur l'autre : c'est le même motif, à la
    // tolérance près — pas deux anniversaires concurrents.
    const lines = [l("D", "Kiss", "2024-03-30"), l("D", "Kiss", "2025-04-02")];
    const signals = computeSeasonalAnniversaries(lines).get("D") ?? [];
    assert.equal(signals.length, 1);
    assert.equal(signals[0].anniversaryMonth, 4, "ancré sur l'occurrence la plus récente");
  });

  test("traite décembre et janvier comme voisins", () => {
    const lines = [l("E", "RHA 3", "2023-12-20"), l("E", "RHA 3", "2025-01-08")];
    const signals = computeSeasonalAnniversaries(lines).get("E") ?? [];
    assert.equal(signals.length, 1, "l'écart circulaire déc→jan vaut 1 mois, pas 11");
  });
});

describe("predictSeasonalOrders", () => {
  test("émet une prédiction par marque saisonnière du compte", () => {
    const lines = [
      l("A", "RHA 2", "2024-03-12"),
      l("A", "RHA 2", "2025-03-20"),
      l("A", "Kiss", "2024-09-05"),
      l("A", "Kiss", "2025-09-11"),
    ];
    const preds = predictSeasonalOrders(lines, monthIndex(2026, 1));
    assert.deepEqual(
      preds.map((p) => [p.brand, p.expectedNextOrderDate]).sort(),
      [
        ["Kiss", "2026-09-01"],
        ["RHA 2", "2026-03-01"],
      ]
    );
    assert.ok(preds.every((p) => p.confidence === "saisonnier"));
  });

  test("vise toujours une occurrence future", () => {
    const lines = [l("A", "RHA 2", "2024-03-12"), l("A", "RHA 2", "2025-03-20")];
    // On se place en juin 2026 : mars 2026 est passé, la cible est mars 2027.
    const preds = predictSeasonalOrders(lines, monthIndex(2026, 6));
    assert.equal(preds[0].expectedNextOrderDate, "2027-03-01");
  });

  test("reprend la médiane des quantités observées", () => {
    const lines = [l("A", "RHA 2", "2024-03-12", 6), l("A", "RHA 2", "2025-03-20", 14)];
    const preds = predictSeasonalOrders(lines, monthIndex(2026, 1));
    assert.equal(preds[0].expectedQty, 10);
  });
});
