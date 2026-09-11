import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Garde-fou de schéma.
 *
 * La table `sector_objectives` a vécu des mois en production sans qu'aucune
 * migration ne la crée : elle avait été appliquée à la main dans l'éditeur
 * SQL Supabase, et la numérotation des fichiers sautait simplement de 0013 à
 * 0015. Rien ne le signalait — la prod marchait. Seule une base reconstruite
 * depuis `supabase db push` (projet de dev, environnement de test) tombait
 * sur une table inexistante, à l'exécution.
 *
 * Ce test relit le code source et les migrations, et refuse tout écart.
 */
const RACINE = path.join(import.meta.dirname, "..", "..");
const DOSSIER_MIGRATIONS = path.join(RACINE, "supabase", "migrations");

function fichiersSource(dir: string, acc: string[] = []): string[] {
  for (const entree of readdirSync(dir, { withFileTypes: true })) {
    if (entree.name === "node_modules" || entree.name === "__tests__" || entree.name.startsWith(".")) continue;
    const complet = path.join(dir, entree.name);
    if (entree.isDirectory()) fichiersSource(complet, acc);
    else if (/\.tsx?$/.test(entree.name)) acc.push(complet);
  }
  return acc;
}

/** Tables lues ou écrites depuis le code, via `.from("…")`. */
function tablesUtilisees(): Map<string, string[]> {
  const parTable = new Map<string, string[]>();
  for (const dossier of ["app", "lib", "components"]) {
    for (const fichier of fichiersSource(path.join(RACINE, dossier))) {
      const source = readFileSync(fichier, "utf8");
      for (const m of source.matchAll(/\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/g)) {
        const liste = parTable.get(m[1]) ?? [];
        liste.push(path.relative(RACINE, fichier));
        parTable.set(m[1], liste);
      }
    }
  }
  return parTable;
}

const sqlMigrations = readdirSync(DOSSIER_MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const sqlComplet = sqlMigrations.map((f) => readFileSync(path.join(DOSSIER_MIGRATIONS, f), "utf8")).join("\n");

const tablesCreees = new Set(
  [...sqlComplet.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)].map((m) =>
    m[1].toLowerCase()
  )
);

describe("cohérence code ↔ migrations", () => {
  test("toute table interrogée par le code est créée par une migration", () => {
    const manquantes = [...tablesUtilisees().entries()]
      .filter(([table]) => !tablesCreees.has(table))
      .map(([table, fichiers]) => `${table} (utilisée dans ${[...new Set(fichiers)].join(", ")})`);

    assert.deepEqual(
      manquantes,
      [],
      "tables absentes des migrations — une base reconstruite depuis db push planterait à l'exécution"
    );
  });

  test("la numérotation des migrations est continue", () => {
    // Un trou signale presque toujours une migration appliquée à la main et
    // jamais versionnée — exactement le cas de 0014.
    const numeros = sqlMigrations.map((f) => Number(f.slice(0, 4)));
    const trous = numeros.filter((n, i) => i > 0 && n !== numeros[i - 1] + 1);
    assert.deepEqual(trous, [], `numérotation discontinue dans ${DOSSIER_MIGRATIONS}`);
  });

  test("chaque table a la sécurité au niveau ligne activée", () => {
    // RLS est la seule barrière entre la clé anon (publique, embarquée dans
    // le navigateur) et les données du secteur.
    const rls = new Set(
      [...sqlComplet.matchAll(/alter\s+table\s+([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/gi)].map((m) =>
        m[1].toLowerCase()
      )
    );
    const sansRls = [...tablesCreees].filter((t) => !rls.has(t)).sort();
    assert.deepEqual(sansRls, [], "tables sans RLS : lisibles par n'importe quel porteur de la clé anon");
  });
});
