import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { allocateToHcps, predictMonthlyForecast } from "@/lib/forecast";
import type { MonthlySaleRow } from "@/lib/forecast";
import type { AccountBrandPrediction, PredictionConfidence } from "@/lib/sonarscore/prediction";
import type { Account } from "@/types/database";

const AN = new Date().getFullYear();

const compte = (patch: Partial<Account> = {}): Account =>
  ({
    id: "A",
    name: "Cabinet test",
    segment: "B",
    status: "actif",
    price_list: "Pro",
    objectif_boites: 200,
    realise_boites: 0,
    ca_2026_ytd: null,
    ca_2025: 40000,
    ca_2024: 30000,
    potentiel_boites: 500,
    jours_silence: 30,
    last_order_date: null,
    nb_refs_achetees_2025: null,
    refs_manquantes: null,
    ...patch,
  }) as Account;

/** Historique mensuel régulier — donne au compte une cadence « Mensuelle ». */
const ventesMensuelles = (dernierMois: number, caParMois = 4000): MonthlySaleRow[] =>
  Array.from({ length: dernierMois }, (_, i) => ({
    account_id: "A",
    year: AN,
    month: i + 1,
    ca: caParMois,
  }));

const pred = (
  brand: string,
  date: string,
  qty: number | null,
  confidence: PredictionConfidence
): AccountBrandPrediction => ({
  accountId: "A",
  brand,
  lastPurchaseDate: `${AN - 1}-01-01`,
  expectedNextOrderDate: date,
  expectedQty: qty,
  confidence,
  intervalUsedDays: null,
  purchaseCount: 3,
});

const MOIS_CIBLES = [
  { year: AN, month: 10 },
  { year: AN, month: 11 },
  { year: AN, month: 12 },
];

const prevoir = (
  predictions: AccountBrandPrediction[],
  patch: Partial<Account> = {},
  ventes: MonthlySaleRow[] = []
) => predictMonthlyForecast(compte(patch), [], ventes, MOIS_CIBLES, [], predictions);

/**
 * Variante à un seul mois cible : la tolérance ±1 du signal saisonnier lui
 * fait sinon remporter le mois PRÉCÉDENT, ce qui masque la comparaison entre
 * confiances qu'on veut observer.
 */
const prevoirNovembre = (predictions: AccountBrandPrediction[]) =>
  predictMonthlyForecast(compte(), [], [], [{ year: AN, month: 11 }], [], predictions);

describe("fusion des signaux produit", () => {
  test("une marque n'est retirée de la compétition qu'une fois la ligne émise", () => {
    // Régression. Le signal saisonnier d'octobre (8 boîtes × poids 0,5 = 4)
    // passe sous le seuil de rentabilité : le mois est abandonné. Mais la
    // marque était déjà marquée « consommée », donc elle ne pouvait plus
    // s'additionner à RHA 2 en novembre — où 8 + 3 = 11 boîtes justifient
    // pourtant largement le passage. Les deux attentes disparaissaient du
    // prévisionnel sans laisser de trace.
    const lignes = prevoir([
      pred("Kiss", `${AN}-10-01`, 8, "saisonnier"),
      pred("RHA 2", `${AN}-11-01`, 3, "compte"),
    ]);

    assert.equal(lignes.length, 1);
    assert.equal(lignes[0].month, 11);
    assert.equal(lignes[0].boites_prevues, 11, "les quantités des deux marques se cumulent");
  });

  test("un même signal ne produit jamais deux lignes sur des mois voisins", () => {
    // L'invariant que la consommation existe pour garantir : la tolérance
    // ±1 du saisonnier chevauche trois mois cibles, sans jamais dédoubler la
    // commande attendue.
    const lignes = prevoir(
      [pred("Kiss", `${AN}-11-01`, 40, "saisonnier")],
      {},
      ventesMensuelles(6)
    );
    const avecKiss = lignes.filter((l) => l.note.includes("Kiss"));
    assert.equal(avecKiss.length, 1, `Kiss apparaît ${avecKiss.length} fois : ${lignes.map((l) => l.note).join(" | ")}`);
  });

  test("additionne les quantités de toutes les marques attendues le même mois", () => {
    const lignes = prevoir([
      pred("RHA 2", `${AN}-11-01`, 6, "compte"),
      pred("RHA 4", `${AN}-11-01`, 9, "compte"),
    ]);
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0].boites_prevues, 15);
    assert.match(lignes[0].note, /RHA 2, RHA 4/);
  });

  test("le rythme propre au compte l'emporte sur la vélocité de marque", () => {
    // Poids 1 contre 0,6 : c'est la confiance la plus forte qui fixe le
    // poids appliqué au total.
    const lignes = prevoirNovembre([
      pred("RHA 2", `${AN}-11-01`, 10, "compte"),
      pred("Kiss", `${AN}-11-01`, 10, "marque"),
    ]);
    assert.equal(lignes[0].boites_prevues, 20, "20 boîtes × poids 1");
  });

  test("la vélocité de marque l'emporte sur le motif saisonnier", () => {
    const lignes = prevoirNovembre([
      pred("Kiss", `${AN}-11-01`, 10, "marque"),
      pred("RHA 3", `${AN}-11-01`, 10, "saisonnier"),
    ]);
    assert.equal(lignes[0].boites_prevues, 12, "20 boîtes × poids 0,6");
    assert.match(lignes[0].note, /Kiss, RHA 3/);
  });

  test("seul le saisonnier tolère un décalage d'un mois", () => {
    // Une prédiction par intervalle porte une date calculée sur l'historique
    // réel : elle ne vaut que pour son mois. Le motif saisonnier, lui, est
    // flou par nature.
    const parIntervalle = prevoir([pred("RHA 2", `${AN}-09-01`, 30, "compte")]);
    assert.deepEqual(parIntervalle.map((l) => l.note), [], "septembre n'est pas un mois cible");

    const saisonnier = prevoir([pred("Kiss", `${AN}-09-01`, 30, "saisonnier")]);
    assert.equal(saisonnier[0]?.month, 10, "octobre est à ±1 mois de septembre");
  });

  test("ignore une marque prédite sans quantité mesurée plutôt que de compter zéro", () => {
    const lignes = prevoir([
      pred("RHA 2", `${AN}-11-01`, 12, "compte"),
      pred("Inconnue", `${AN}-11-01`, null, "compte"),
    ]);
    assert.equal(lignes[0].boites_prevues, 12);
  });
});

describe("repli quand aucun signal produit ne s'applique", () => {
  test("une commande réelle le mois cible n'est jamais doublée d'une prévision", () => {
    const ventes = [...ventesMensuelles(6), { account_id: "A", year: AN, month: 11, ca: 5000 }];
    const lignes = prevoir([pred("RHA 2", `${AN}-11-01`, 30, "compte")], {}, ventes);
    assert.equal(lignes.filter((l) => l.month === 11).length, 0);
  });

  test("se rabat sur la cadence de commande du compte", () => {
    // Dernière commande en septembre, cible en octobre : pile dans le rythme.
    const lignes = prevoir([], {}, ventesMensuelles(9));
    assert.equal(lignes[0]?.month, 10);
    assert.match(lignes[0].note, /Récurrence mensuelle/);
  });

  test("perd en confiance à mesure que les cycles sont manqués", () => {
    // Dernière commande en juin, cible en octobre : quatre cycles mensuels
    // sautés. Ce n'est plus un compte « dû ce mois-ci », c'est un compte à
    // reconquérir — le générateur doit le dire et réduire le montant.
    const dansLeRythme = prevoir([], {}, ventesMensuelles(9))[0];
    const enRetard = prevoir([], {}, ventesMensuelles(6))[0];
    assert.match(enRetard.note, /cycles manqués/);
    assert.ok(
      enRetard.boites_prevues < dansLeRythme.boites_prevues,
      "un retard prolongé doit peser moins, pas autant"
    );
  });

  test("un prospect sans historique reçoit une prévision prudente", () => {
    const lignes = prevoir([], {
      status: "new",
      objectif_boites: 0,
      potentiel_boites: 400,
      jours_silence: 0,
      ca_2024: 0,
      ca_2025: 0,
      ca_2026_ytd: 0,
    });
    assert.ok(lignes.length > 0);
    assert.match(lignes[0].note, /Prospect/);
    // 5 % du potentiel comme commande d'amorçage, elle-même pondérée à 0,3 :
    // le montant doit rester une fraction du potentiel, pas une extrapolation.
    assert.ok(lignes[0].boites_prevues < 400 * 0.05, "l'amorçage reste sous la commande type");
  });

  test("un compte déjà bien pénétré ne reçoit aucune relance de principe", () => {
    // Même statut « nouveau », mais un CA proche de son potentiel : le score
    // de ciblage conclut « fidéliser », et le générateur se tait plutôt que
    // d'inventer un passage.
    const lignes = prevoir([], {
      status: "new",
      objectif_boites: 0,
      potentiel_boites: 400,
      jours_silence: 0,
      ca_2025: 40000,
    });
    assert.deepEqual(lignes, []);
  });
});

describe("bornes du générateur", () => {
  test("la somme générée ne dépasse jamais le restant à faire", () => {
    const restant = 14;
    const lignes = prevoir(
      [
        pred("RHA 2", `${AN}-10-01`, 30, "compte"),
        pred("RHA 4", `${AN}-11-01`, 30, "compte"),
        pred("Kiss", `${AN}-12-01`, 30, "compte"),
      ],
      { objectif_boites: restant, realise_boites: 0 }
    );
    const total = lignes.reduce((s, l) => s + l.boites_prevues, 0);
    assert.ok(total <= restant, `${total} boîtes générées pour ${restant} restantes`);
  });

  test("aucune prévision quand l'objectif est déjà atteint", () => {
    const lignes = prevoir([pred("RHA 2", `${AN}-11-01`, 30, "compte")], {
      objectif_boites: 100,
      realise_boites: 100,
    });
    assert.deepEqual(lignes, []);
  });

  test("n'émet pas de commande trop petite pour justifier un passage", () => {
    const lignes = prevoir([pred("RHA 2", `${AN}-11-01`, 2, "compte")]);
    assert.deepEqual(lignes, []);
  });

  test("chaque ligne porte un CA cohérent avec ses boîtes", () => {
    const lignes = prevoir([pred("RHA 2", `${AN}-11-01`, 20, "compte")]);
    assert.ok(lignes[0].ca_prevu > 0);
    assert.ok(Number.isInteger(lignes[0].ca_prevu));
    assert.ok(Number.isInteger(lignes[0].boites_prevues));
  });
});

describe("allocateToHcps", () => {
  const hcp = (id: string, potentiel: number | null) => ({ id, name: `Dr ${id}`, potentiel_boites: potentiel });

  test("répartit au prorata du potentiel", () => {
    const parts = allocateToHcps([hcp("a", 30), hcp("b", 10)], 40, 4000);
    const a = parts.find((p) => p.hcpId === "a")!;
    const b = parts.find((p) => p.hcpId === "b")!;
    assert.equal(a.boites, 30);
    assert.equal(b.boites, 10);
  });

  test("conserve le total de boîtes malgré les arrondis", () => {
    const parts = allocateToHcps([hcp("a", 1), hcp("b", 1), hcp("c", 1)], 10, 1000);
    assert.equal(parts.reduce((s, p) => s + p.boites, 0), 10);
  });

  test("ne retient que les trois premiers médecins", () => {
    const parts = allocateToHcps(
      [hcp("a", 50), hcp("b", 40), hcp("c", 30), hcp("d", 20), hcp("e", 10)],
      150,
      15000
    );
    assert.ok(parts.length <= 3);
    assert.deepEqual(parts.map((p) => p.hcpId), ["a", "b", "c"]);
  });

  test("n'invente pas de répartition sans médecin", () => {
    assert.deepEqual(allocateToHcps([], 40, 4000), []);
  });
});
