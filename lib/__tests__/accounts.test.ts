import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isProspect, recurrenceBucket, recurrenceByAccount, statusFromLastOrder } from "@/lib/accounts";
import { DAY_MS, monthIndex } from "@/lib/dates";
import type { Account } from "@/types/database";

const ilYA = (jours: number) => new Date(Date.now() - jours * DAY_MS).toISOString().slice(0, 10);

describe("statusFromLastOrder", () => {
  test("classe selon l'ancienneté de la dernière commande", () => {
    assert.equal(statusFromLastOrder(ilYA(30)), "actif");
    assert.equal(statusFromLastOrder(ilYA(300)), "a_risque");
    assert.equal(statusFromLastOrder(ilYA(900)), "lost");
  });

  test("respecte les seuils de 180 et 730 jours", () => {
    assert.equal(statusFromLastOrder(ilYA(180)), "actif");
    assert.equal(statusFromLastOrder(ilYA(181)), "a_risque");
    assert.equal(statusFromLastOrder(ilYA(730)), "a_risque");
    assert.equal(statusFromLastOrder(ilYA(731)), "lost");
  });

  test("un compte n'ayant jamais commandé reste à suivre, pas perdu", () => {
    assert.equal(statusFromLastOrder(null), "a_suivre");
  });
});

describe("recurrenceBucket", () => {
  const m = (...mois: [number, number][]) => mois.map(([y, mo]) => monthIndex(y, mo));

  test("déduit la cadence de l'écart moyen entre commandes", () => {
    assert.equal(recurrenceBucket(m([2026, 1], [2026, 2], [2026, 3], [2026, 4])), "Mensuelle");
    assert.equal(recurrenceBucket(m([2026, 1], [2026, 3], [2026, 5])), "Bimestrielle");
    assert.equal(recurrenceBucket(m([2026, 1], [2026, 4], [2026, 7])), "Trimestrielle");
    assert.equal(recurrenceBucket(m([2025, 1], [2026, 1])), "Espacée");
  });

  test("une seule commande ne constitue pas une cadence", () => {
    assert.equal(recurrenceBucket(m([2026, 5])), "Unique");
    assert.equal(recurrenceBucket([]), "Unique");
  });

  test("ne dépend pas de l'ordre des mois fournis", () => {
    assert.equal(recurrenceBucket(m([2026, 5], [2026, 1], [2026, 3])), "Bimestrielle");
  });
});

describe("recurrenceByAccount", () => {
  test("ignore les mois sans chiffre d'affaires", () => {
    // Une ligne à 0 € n'est pas une commande : la compter fausserait la
    // cadence en rapprochant artificiellement deux achats réels.
    const cadence = recurrenceByAccount([
      { account_id: "A", year: 2026, month: 1, ca: 1000 },
      { account_id: "A", year: 2026, month: 2, ca: 0 },
      { account_id: "A", year: 2026, month: 3, ca: 800 },
      { account_id: "A", year: 2026, month: 5, ca: 900 },
    ]);
    assert.equal(cadence.get("A"), "Bimestrielle");
  });

  test("traite chaque compte séparément", () => {
    const cadence = recurrenceByAccount([
      { account_id: "A", year: 2026, month: 1, ca: 100 },
      { account_id: "A", year: 2026, month: 2, ca: 100 },
      { account_id: "B", year: 2026, month: 1, ca: 100 },
    ]);
    assert.equal(cadence.get("A"), "Mensuelle");
    assert.equal(cadence.get("B"), "Unique");
  });
});

describe("isProspect", () => {
  const compte = (patch: Partial<Account>): Account =>
    ({
      id: "x",
      status: "actif",
      last_order_date: null,
      ca_2024: 0,
      ca_2025: 0,
      ca_2026_ytd: 0,
      ...patch,
    }) as Account;

  test("un compte silencieux depuis plus d'un an est un prospect", () => {
    assert.equal(isProspect(compte({ last_order_date: ilYA(400) })), true);
    assert.equal(isProspect(compte({ last_order_date: ilYA(300) })), false);
  });

  test("les statuts lost et new le sont d'office", () => {
    assert.equal(isProspect(compte({ status: "lost", last_order_date: ilYA(10) })), true);
    assert.equal(isProspect(compte({ status: "new", last_order_date: ilYA(10) })), true);
  });

  test("sans date ni CA, le compte n'a jamais commandé", () => {
    assert.equal(isProspect(compte({})), true);
  });

  test("sans date mais avec du CA historique, ce n'est pas un prospect", () => {
    assert.equal(isProspect(compte({ ca_2025: 12000 })), false);
  });
});
