import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { availableYears, referenceYears, revenueByAccountYear, revenueForYear } from "@/lib/revenue";
import type { YearlySaleRow } from "@/lib/revenue";
import type { Account } from "@/types/database";

const compte = (patch: Partial<Account> = {}): Account => ({ id: "A", ...patch }) as Account;

const ventes: YearlySaleRow[] = [
  { account_id: "A", year: 2025, ca: 1000 },
  { account_id: "A", year: 2025, ca: 500 },
  { account_id: "A", year: 2026, ca: 2000 },
  { account_id: "B", year: 2026, ca: 300 },
];

describe("revenueByAccountYear", () => {
  test("additionne les mois d'une même année", () => {
    const parAnnee = revenueByAccountYear(ventes);
    assert.equal(parAnnee.get("A|2025"), 1500);
    assert.equal(parAnnee.get("A|2026"), 2000);
  });

  test("sépare les comptes", () => {
    assert.equal(revenueByAccountYear(ventes).get("B|2026"), 300);
  });

  test("ignore les mois à zéro plutôt que de créer une entrée vide", () => {
    const parAnnee = revenueByAccountYear([{ account_id: "C", year: 2026, ca: 0 }]);
    assert.equal(parAnnee.has("C|2026"), false);
  });
});

describe("revenueForYear", () => {
  const parAnnee = revenueByAccountYear(ventes);

  test("préfère les ventes mensuelles réelles à la colonne héritée", () => {
    // La colonne annuelle est une pré-agrégation des mêmes factures : quand
    // les deux existent, la donnée fine fait foi.
    const a = compte({ ca_2025: 999999 });
    assert.equal(revenueForYear(a, 2025, parAnnee), 1500);
  });

  test("se replie sur la colonne héritée sans historique mensuel", () => {
    // Les CA 2022-2024 viennent de l'ancien PAS et n'ont jamais été recoupés
    // par des factures : sans repli, ils disparaîtraient de l'app.
    const a = compte({ ca_2023: 42000 });
    assert.equal(revenueForYear(a, 2023, parAnnee), 42000);
  });

  test("renvoie zéro quand rien n'est connu — l'absence de facture est un CA nul", () => {
    assert.equal(revenueForYear(compte(), 2024, parAnnee), 0);
  });

  test("fonctionne pour une année sans colonne dédiée", () => {
    // Le cœur du sujet : 2027 et au-delà, sans migration ni code à toucher.
    const futur = revenueByAccountYear([{ account_id: "A", year: 2027, ca: 7777 }]);
    assert.equal(revenueForYear(compte(), 2027, futur), 7777);
  });
});

describe("availableYears", () => {
  test("liste les années réellement documentées, dans l'ordre", () => {
    const now = new Date(2026, 5, 1);
    assert.deepEqual(availableYears(ventes, [], now), [2025, 2026]);
  });

  test("inclut les années portées seulement par une colonne héritée", () => {
    const now = new Date(2026, 5, 1);
    assert.deepEqual(availableYears(ventes, [compte({ ca_2023: 5000 })], now), [2023, 2025, 2026]);
  });

  test("ignore une colonne héritée vide", () => {
    const now = new Date(2026, 5, 1);
    assert.deepEqual(availableYears(ventes, [compte({ ca_2022: 0, ca_2023: null })], now), [2025, 2026]);
  });

  test("propose toujours l'année en cours, même sans la moindre facture", () => {
    // Au 1er janvier, aucune vente n'est encore enregistrée : l'année doit
    // rester sélectionnable, sinon le dashboard s'ouvre sur l'an dernier.
    const premierJanvier = new Date(2028, 0, 1);
    assert.ok(availableYears([], [], premierJanvier).includes(2028));
  });
});

describe("referenceYears", () => {
  test("désigne le dernier exercice clos et le précédent", () => {
    assert.deepEqual(referenceYears(new Date(2026, 8, 11)), { derniereAnnee: 2025, anneePrecedente: 2024 });
  });

  test("suit le changement d'année sans intervention", () => {
    // C'est tout l'enjeu : le score de ciblage comparait 2024 à 2025 en dur,
    // et l'aurait fait encore en 2030.
    assert.deepEqual(referenceYears(new Date(2027, 0, 2)), { derniereAnnee: 2026, anneePrecedente: 2025 });
  });
});
