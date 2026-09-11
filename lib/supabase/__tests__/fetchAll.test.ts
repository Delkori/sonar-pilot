import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fetchAll } from "@/lib/supabase/fetchAll";

/**
 * Faux builder PostgREST : enregistre les plages demandées et sert des
 * tranches d'un jeu de données, exactement comme le ferait Supabase avec
 * son plafond `max-rows`.
 */
function fakeTable(rows: { id: number }[], pageCap = 1000) {
  const ranges: [number, number][] = [];
  const build = () => ({
    order() {
      return {
        async range(from: number, to: number) {
          ranges.push([from, to]);
          const taille = Math.min(to - from + 1, pageCap);
          return { data: rows.slice(from, from + taille), error: null };
        },
      };
    },
  });
  return { build, ranges };
}

describe("fetchAll", () => {
  test("récupère les lignes au-delà du plafond d'une seule réponse", async () => {
    // Le cœur du problème corrigé : un select() nu se serait arrêté à 1000
    // lignes sans erreur ni avertissement.
    const rows = Array.from({ length: 2350 }, (_, i) => ({ id: i }));
    const { build } = fakeTable(rows);
    const out = await fetchAll(build);
    assert.equal(out.length, 2350);
    assert.deepEqual(out[0], { id: 0 });
    assert.deepEqual(out.at(-1), { id: 2349 });
  });

  test("s'arrête dès qu'une page est incomplète", async () => {
    const { build, ranges } = fakeTable(Array.from({ length: 1200 }, (_, i) => ({ id: i })));
    await fetchAll(build);
    assert.equal(ranges.length, 2, "une page pleine puis une page partielle : rien de plus");
    assert.deepEqual(ranges, [
      [0, 999],
      [1000, 1999],
    ]);
  });

  test("demande des plages contiguës, sans trou ni recouvrement", async () => {
    const { build, ranges } = fakeTable(Array.from({ length: 2500 }, (_, i) => ({ id: i })));
    await fetchAll(build);
    for (let i = 1; i < ranges.length; i++) {
      assert.equal(ranges[i][0], ranges[i - 1][1] + 1);
    }
  });

  test("un jeu vide ne coûte qu'une requête", async () => {
    const { build, ranges } = fakeTable([]);
    assert.deepEqual(await fetchAll(build), []);
    assert.equal(ranges.length, 1);
  });

  test("un total exactement multiple de la page ne boucle pas indéfiniment", async () => {
    const { build, ranges } = fakeTable(Array.from({ length: 2000 }, (_, i) => ({ id: i })));
    const out = await fetchAll(build);
    assert.equal(out.length, 2000);
    assert.equal(ranges.length, 3, "la 3e page revient vide et termine la boucle");
  });

  test("remonte l'erreur plutôt que de rendre un jeu partiel", async () => {
    // Renvoyer les lignes déjà lues serait le pire des cas : un résultat
    // incomplet qui se ferait passer pour complet.
    const build = () => ({
      order: () => ({
        async range() {
          return { data: null, error: { message: "connexion perdue" } };
        },
      }),
    });
    await assert.rejects(() => fetchAll(build), /connexion perdue/);
  });

  test("trie sur la clé demandée pour que la pagination soit stable", async () => {
    // Sans ORDER BY, Postgres ne garantit aucun ordre entre deux `range` :
    // une ligne peut sortir deux fois, ou pas du tout.
    const colonnes: string[] = [];
    const build = () => ({
      order: (column: string, options: { ascending: boolean }) => {
        colonnes.push(`${column}:${options.ascending ? "asc" : "desc"}`);
        return { async range() { return { data: [], error: null }; } };
      },
    });
    await fetchAll(build);
    await fetchAll(build, { orderBy: "imported_at", ascending: false });
    assert.deepEqual(colonnes, ["id:asc", "imported_at:desc"]);
  });
});
