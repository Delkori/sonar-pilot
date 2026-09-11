import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { predictPortfolioForecast } from "@/lib/forecast";
import type { HcpLite, MonthlySaleRow } from "@/lib/forecast";
import type { ExistingForecastEntry } from "@/lib/forecast";
import type { Account, SectorObjective } from "@/types/database";

const AN = new Date().getFullYear();
const MOIS = [{ year: AN, month: 11 }];

const compte = (id: string, patch: Partial<Account> = {}): Account =>
  ({
    id,
    name: `Compte ${id}`,
    segment: "B",
    status: "actif",
    price_list: "Pro",
    objectif_boites: 0,
    realise_boites: 0,
    ca_2026_ytd: null,
    ca_2025: 20000,
    ca_2024: 18000,
    potentiel_boites: 300,
    jours_silence: 30,
    last_order_date: `${AN}-09-15`,
    nb_refs_achetees_2025: null,
    refs_manquantes: null,
    ...patch,
  }) as Account;

/** Historique d'achats réel — condition d'entrée dans le comblement. */
const ventes = (id: string, jusquAuMois = 9, caParMois = 3000): MonthlySaleRow[] =>
  Array.from({ length: jusquAuMois }, (_, i) => ({ account_id: id, year: AN, month: i + 1, ca: caParMois }));

const objectif = (objectif_ca: number): SectorObjective[] => [
  { id: "o1", year: AN, month: 11, objectif_ca, objectif_boites: 0, updated_at: "" } as SectorObjective,
];

const prevoir = (
  accounts: Account[],
  sales: MonthlySaleRow[],
  objectifs: SectorObjective[],
  hcps: Map<string, HcpLite[]> = new Map()
) => predictPortfolioForecast(accounts, hcps, sales, [], MOIS, objectifs, []);

const totalCa = (lignes: { ca_prevu: number }[]) => lignes.reduce((s, l) => s + l.ca_prevu, 0);

describe("comblement de l'objectif secteur", () => {
  test("ne se déclenche pas quand aucun objectif n'est saisi", () => {
    const sansObjectif = prevoir([compte("A")], ventes("A"), []);
    assert.ok(sansObjectif.every((l) => !l.note.includes("objectif secteur")));
  });

  test("complète l'écart quand la génération de base reste sous l'objectif", () => {
    const base = prevoir([compte("A")], ventes("A"), []);
    const comble = prevoir([compte("A")], ventes("A"), objectif(30000));
    assert.ok(totalCa(comble) > totalCa(base), "le comblement doit ajouter du volume");
    assert.ok(comble.some((l) => /objectif secteur/.test(l.note)));
  });

  test("ne dépasse jamais le potentiel réel du compte", () => {
    // Le seul plafond dur : on ne comble pas un objectif en inventant de la
    // capacité de marché. Objectif volontairement hors d'atteinte.
    const potentiel = 60;
    const lignes = prevoir([compte("A", { potentiel_boites: potentiel })], ventes("A"), objectif(5_000_000));
    const boites = lignes.reduce((s, l) => s + l.boites_prevues, 0);
    assert.ok(boites <= potentiel, `${boites} boîtes prévues pour un potentiel de ${potentiel}`);
  });

  test("laisse subsister l'écart plutôt que d'inventer de la demande", () => {
    const objectifCa = 5_000_000;
    const lignes = prevoir([compte("A", { potentiel_boites: 60 })], ventes("A"), objectif(objectifCa));
    assert.ok(totalCa(lignes) < objectifCa, "un écart résiduel est un signal réel, pas un bug");
  });

  test("écarte les comptes sans aucun achat observé", () => {
    // Combler avec une commande jamais vue chez ce compte produirait une
    // ligne qu'aucun commercial ne prendra au sérieux.
    const vierge = compte("V", { potentiel_boites: 2000, ca_2025: 0, ca_2024: 0, last_order_date: null });
    const lignes = prevoir([vierge], [], objectif(200000));
    assert.ok(lignes.every((l) => !/objectif secteur/.test(l.note)));
  });

  test("écarte les comptes perdus", () => {
    const perdu = compte("L", { status: "lost", potentiel_boites: 2000 });
    const lignes = prevoir([perdu], ventes("L"), objectif(200000));
    assert.deepEqual(lignes.filter((l) => l.account_id === "L"), []);
  });

  test("ne fait pas reposer un mois sur un seul client", () => {
    // Plafond de concentration : 25 % de l'objectif du mois par compte.
    const objectifCa = 100000;
    const portefeuille = ["A", "B", "C", "D", "E", "F"].map((id) => compte(id, { potentiel_boites: 2000 }));
    const toutesVentes = portefeuille.flatMap((c) => ventes(c.id));
    const lignes = prevoir(portefeuille, toutesVentes, objectif(objectifCa));

    const parCompte = new Map<string, number>();
    for (const l of lignes) parCompte.set(l.account_id, (parCompte.get(l.account_id) ?? 0) + l.ca_prevu);
    for (const [id, ca] of parCompte) {
      assert.ok(
        ca <= objectifCa * 0.25 * 1.02, // tolérance : l'arrondi au nombre entier de boîtes
        `${id} porte ${ca} € sur un objectif de ${objectifCa} €`
      );
    }
  });

  test("n'émet qu'une ligne par compte et par mois", () => {
    // La table est indexée sur (compte, année, mois, nature) : deux lignes
    // concurrentes, et l'upsert n'en garderait qu'une, au hasard.
    const portefeuille = ["A", "B", "C"].map((id) => compte(id, { potentiel_boites: 1500 }));
    const lignes = prevoir(portefeuille, portefeuille.flatMap((c) => ventes(c.id)), objectif(150000));
    const cles = lignes.map((l) => `${l.account_id}-${l.year}-${l.month}`);
    assert.equal(new Set(cles).size, cles.length, "doublon compte × mois");
  });

  test("renforce la ligne existante au lieu d'en ouvrir une seconde", () => {
    // Régression. La passe classe en tête les comptes déjà retenus ce
    // mois-ci — puis l'espacement minimum les rejetait tous, l'écart valant
    // 0 puisque la génération de base venait d'inscrire ce même mois. La
    // stratégie principale ne s'appliquait jamais et la branche de fusion
    // était du code mort : l'écart restait béant malgré le potentiel
    // disponible.
    const base = prevoir([compte("A")], ventes("A"), []);
    const comble = prevoir([compte("A")], ventes("A"), objectif(30000));

    assert.equal(comble.length, 1, "une seule ligne, complétée sur place");
    assert.ok(comble[0].boites_prevues > base[0].boites_prevues);
    assert.match(comble[0].note, /Complément pour l'objectif secteur/);
    assert.match(comble[0].note, /Rythme mensuelle/, "le motif d'origine est conservé");
  });

  test("ne touche jamais un mois saisi à la main", () => {
    // La saisie manuelle n'est pas réécrite, et la fusion ne regarde que les
    // lignes générées : y ajouter du volume créerait une seconde ligne sur la
    // même clé (compte, année, mois), dont l'upsert ne garderait qu'une.
    const manuel: ExistingForecastEntry[] = [
      { account_id: "A", year: AN, month: 11, boites_prevues: 4, ca_prevu: 500, source: "manuel" },
    ];
    const lignes = predictPortfolioForecast(
      [compte("A", { potentiel_boites: 2000 })],
      new Map(),
      ventes("A"),
      manuel,
      MOIS,
      objectif(200000),
      []
    );
    assert.deepEqual(
      lignes.filter((l) => l.account_id === "A" && l.month === 11),
      [],
      "aucune ligne générée ne doit concurrencer la saisie manuelle"
    );
  });

  test("la répartition par médecin suit le total après complément", () => {
    // Régression : le complément ajoutait des boîtes à une ligne existante
    // sans recalculer sa répartition, qui ne totalisait donc plus le montant
    // affiché.
    const hcps = new Map<string, HcpLite[]>([
      ["A", [{ id: "h1", name: "Dr Un", potentiel_boites: 200 }, { id: "h2", name: "Dr Deux", potentiel_boites: 100 }]],
    ]);
    const lignes = predictPortfolioForecast(
      [compte("A", { potentiel_boites: 1500 })],
      hcps,
      ventes("A"),
      [],
      MOIS,
      objectif(80000),
      []
    );
    for (const l of lignes) {
      if (l.hcp.length === 0) continue;
      const somme = l.hcp.reduce((s, h) => s + h.boites, 0);
      assert.equal(somme, l.boites_prevues, `${l.note} : ${somme} boîtes réparties pour ${l.boites_prevues} prévues`);
    }
  });
});
