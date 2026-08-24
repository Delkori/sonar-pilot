// Classification des marques — fillers (gamme injectable acide hyaluronique)
// vs le reste (dermo-cosmétique, mais aussi lignes administratives non
// commerciales : bandeaux, cartes implant, échantillons... qui remontent
// parfois comme "marque" dans les imports bruts et polluent les stats si on
// ne les exclut pas explicitement).
//
// Liste alignée sur `canonicalizeBrand` (lib/import/salesforceParser.ts) — à
// tenir à jour si une nouvelle référence filler est ajoutée là-bas.

export const FILLER_BRANDS = new Set([
  "RHA 1",
  "RHA 2",
  "RHA 3",
  "RHA 4",
  "RHA Kiss Volume",
  "Kiss",
  "Redensity 1",
  "Redensity 2",
  "Ultra Deep",
  "Deep Lines",
  "Global Action",
  "Ultimate",
]);

export function isFillerBrand(brand: string): boolean {
  return FILLER_BRANDS.has(brand);
}

export type BrandCategory = "filler" | "dermo";

/**
 * "dermo" ici est un fourre-tout par exclusion : tout ce qui n'est pas un
 * filler connu — gamme dermo-cosmétique réelle, mais aussi bandeaux, cartes
 * implant, échantillons, etc. Utile pour un filtre d'affichage (matrice
 * produit) ; pour des stats qui ne doivent pas être polluées par ces lignes
 * non commerciales (ex. modèles persona), préférer `isFillerBrand` en filtre
 * positif plutôt que d'agréger "dermo" tel quel.
 */
export function brandCategory(brand: string): BrandCategory {
  return isFillerBrand(brand) ? "filler" : "dermo";
}
