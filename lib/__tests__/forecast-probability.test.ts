import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { predictPortfolioForecast } from "@/lib/forecast";
import type { ForecastProbabilityGate, HcpLite, MonthlySaleRow } from "@/lib/forecast";
import { monthIndex } from "@/lib/dates";
import type { Account, SectorObjective } from "@/types/database";

const AN = new Date().getFullYear();
const MOIS = [
  { year: AN, month: 11 },
  { year: AN, month: 12 },
];

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

/** Commandes mensuelles régulières de janvier à septembre. */
const ventes = (id: string, jusquAuMois = 9, caParMois = 3000): MonthlySaleRow[] =>
  Array.from({ length: jusquAuMois }, (_, i) => ({ account_id: id, year: AN, month: i + 1, ca: caParMois }));

const objectif = (objectif_ca: number): SectorObjective[] =>
  MOIS.map((m, i) => ({ id: `o${i}`, ...m, objectif_ca, objectif_boites: 0, updated_at: "" }) as SectorObjective);

const prevoir = (
  accounts: Account[],
  sales: MonthlySaleRow[],
  gate?: ForecastProbabilityGate,
  objectifs: SectorObjective[] = [],
  hcps: Map<string, HcpLite[]> = new Map()
) => predictPortfolioForecast(accounts, hcps, sales, [], MOIS, objectifs, [], gate);

const chanceFixe = (parCompte: Record<string, number>, min = 0.2): ForecastProbabilityGate => ({
  probabilityOf: (id) => parCompte[id] ?? null,
  minProbability: min,
});

describe("générateur branché sur la probabilité de commande", () => {
  test("sans filtre, le résultat est inchangé et chaque ligne porte sa chance", () => {
    const comptes = [compte("A"), compte("B")];
    const sales = [...ventes("A"), ...ventes("B")];
    const sansGate = prevoir(comptes, sales);
    const gateOuvert = prevoir(comptes, sales, chanceFixe({ A: 0.05, B: 0.6 }, 0));
    assert.ok(sansGate.length > 0, "le jeu de test doit produire des lignes");
    assert.deepEqual(
      gateOuvert.map((l) => [l.account_id, l.month, l.ca_prevu]),
      sansGate.map((l) => [l.account_id, l.month, l.ca_prevu])
    );
    assert.ok(gateOuvert.filter((l) => l.account_id === "A").every((l) => l.probabilite === 0.05));
    assert.ok(gateOuvert.filter((l) => l.account_id === "B").every((l) => l.probabilite === 0.6));
    assert.ok(sansGate.every((l) => l.probabilite === null || l.probabilite === undefined));
  });

  test("sous le seuil, aucune ligne n'est générée pour le compte", () => {
    const comptes = [compte("A"), compte("B")];
    const sales = [...ventes("A"), ...ventes("B")];
    const lignes = prevoir(comptes, sales, chanceFixe({ A: 0.05, B: 0.6 }, 0.2));
    assert.equal(lignes.filter((l) => l.account_id === "A").length, 0);
    assert.ok(lignes.filter((l) => l.account_id === "B").length > 0);
  });

  test("une chance inconnue (null) laisse passer la ligne", () => {
    const lignes = prevoir([compte("A")], ventes("A"), chanceFixe({}, 0.5));
    assert.ok(lignes.length > 0);
    assert.ok(lignes.every((l) => l.probabilite === null));
  });

  test("les lignes déjà posées sur les mois d'avant sont transmises comme commandes anticipées", () => {
    const appels: { month: number; anticipated: number[] }[] = [];
    const gate: ForecastProbabilityGate = {
      probabilityOf: (_id, monthIdx, anticipated) => {
        appels.push({ month: monthIdx, anticipated: anticipated.map((a) => a.month) });
        return 0.9;
      },
      minProbability: 0,
    };
    // Compte mensuel : une ligne attendue en novembre puis en décembre.
    const lignes = prevoir([compte("A")], ventes("A"), gate);
    const nov = monthIndex(AN, 11);
    const dec = monthIndex(AN, 12);
    assert.deepEqual(lignes.map((l) => monthIndex(l.year, l.month)), [nov, dec]);
    const appelDec = appels.find((a) => a.month === dec);
    assert.ok(appelDec, "le modèle doit être interrogé pour décembre");
    assert.deepEqual(appelDec.anticipated, [nov], "la ligne de novembre est une commande anticipée pour décembre");
    const appelNov = appels.find((a) => a.month === nov);
    assert.deepEqual(appelNov?.anticipated, []);
  });

  test("le comblement de l'objectif secteur ignore les comptes sous le seuil et préfère les plus probables", () => {
    // Trois comptes éprouvés, mêmes potentiels : seul le classement par
    // chance décide qui comble l'écart.
    const comptes = [compte("A"), compte("B"), compte("C")];
    const sales = [...ventes("A"), ...ventes("B"), ...ventes("C")];
    const gate = chanceFixe({ A: 0.05, B: 0.4, C: 0.8 }, 0.2);
    const base = prevoir(comptes, sales, gate);
    const comble = prevoir(comptes, sales, gate, objectif(60000));
    const complement = comble.filter((l) => /objectif secteur/.test(l.note));
    assert.ok(complement.length > 0, "l'objectif doit déclencher un comblement");
    assert.ok(complement.every((l) => l.account_id !== "A"), "A, sous le seuil, ne comble jamais");
    const caC = comble.filter((l) => l.account_id === "C").reduce((s, l) => s + l.ca_prevu, 0);
    const caB = comble.filter((l) => l.account_id === "B").reduce((s, l) => s + l.ca_prevu, 0);
    assert.ok(caC >= caB, "le compte le plus probable reçoit au moins autant de complément");
    assert.ok(comble.reduce((s, l) => s + l.ca_prevu, 0) > base.reduce((s, l) => s + l.ca_prevu, 0));
  });
});
