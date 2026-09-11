import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mean, median, medianOrZero, sum } from "@/lib/stats";

describe("median", () => {
  test("prend la valeur centrale sur un effectif impair", () => {
    assert.equal(median([5, 1, 3]), 3);
  });

  test("moyenne les deux valeurs centrales sur un effectif pair", () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  test("ne modifie pas le tableau reçu", () => {
    const input = [3, 1, 2];
    median(input);
    assert.deepEqual(input, [3, 1, 2]);
  });

  test("distingue « aucune valeur » de « zéro »", () => {
    // Les deux variantes existent parce que les appelants historiques
    // divergeaient sur ce point : une médiane absente n'est pas 0.
    assert.equal(median([]), null);
    assert.equal(medianOrZero([]), 0);
    assert.equal(median([0, 0]), 0);
  });
});

describe("sum / mean", () => {
  test("sum d'un tableau vide vaut 0", () => {
    assert.equal(sum([]), 0);
    assert.equal(sum([2, -5, 3]), 0);
  });

  test("mean renvoie null sans valeur", () => {
    assert.equal(mean([]), null);
    assert.equal(mean([2, 4, 9]), 5);
  });
});
