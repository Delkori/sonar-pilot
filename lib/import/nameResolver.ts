// Rapprochement flou entre les noms de client des factures et les noms de
// compte du référentiel Salesforce, qui diffèrent souvent par un préfixe
// de structure ("DR BEILLE Laurence" vs "CABINET DR BEILLE Laurence").
// Calibré et vérifié contre les vrais fichiers de l'utilisateur : 67/70
// noms non exact-matchés résolvent à confiance 1.0 avec cette méthode.

const STRUCTURE_PREFIXES = new Set([
  "CABINET",
  "SELARL",
  "SELAS",
  "SAS",
  "SCM",
  "SARL",
  "CENTRE",
  "CLINIQUE",
  "EURL",
  "GROUPEMENT",
  "SCP",
  "SCI",
  "DR",
  "DOCTEUR",
]);

// Tokens de "bruit" à ignorer en plus des préfixes de structure : mentions
// de statut ajoutées par Salesforce (INACTIVE) qui ne portent pas de sens
// pour le rapprochement.
const NOISE_TOKENS = new Set(["INACTIVE", "INACTIF", "FERME", "FERMEE"]);

function tokenSet(name: string): Set<string> {
  const stripped = name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/\([^)]*\)/g, " ") // supprime le contenu entre parenthèses, ex. "(INACTIVE)"
    .replace(/[^A-Z0-9 ]/g, " ");
  const tokens = stripped
    .split(/\s+/)
    .filter((t) => t && !STRUCTURE_PREFIXES.has(t) && !NOISE_TOKENS.has(t));
  return new Set(tokens);
}

/** Score de 0 à 1 : proportion des tokens du plus petit nom retrouvés dans l'autre. */
export function nameMatchScore(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  return intersection / Math.min(ta.size, tb.size);
}

export interface MatchCandidate {
  accountId: string;
  accountName: string;
  score: number;
}

/** Meilleur candidat parmi une liste de comptes (id, name). */
export function bestMatch(rawName: string, accounts: { id: string; name: string }[]): MatchCandidate | null {
  let best: MatchCandidate | null = null;
  for (const a of accounts) {
    const score = nameMatchScore(rawName, a.name);
    if (!best || score > best.score) best = { accountId: a.id, accountName: a.name, score };
  }
  return best;
}

export const HIGH_CONFIDENCE = 0.8;
export const LOW_CONFIDENCE = 0.4;
