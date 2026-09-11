import { PageShell } from "@/components/layout/PageShell";
import { PersonaClient } from "@/components/personas/PersonaClient";
import type { PersonaAccountRow } from "@/components/personas/PersonaClient";
import { createClient } from "@/lib/supabase/server";
import { getAccountProducts, getAccounts } from "@/lib/data/queries";
import {
  computePersonaModels,
  personaRecommendations,
  computeAssociationRules,
  crossSellRecommendations,
  PERSONAS,
  type Persona,
} from "@/lib/persona";
import { isFillerBrand } from "@/lib/brands";

export const dynamic = "force-dynamic";

function isPersona(v: string | null): v is Persona {
  return v !== null && (PERSONAS as readonly string[]).includes(v);
}

export default async function PersonasPage() {
  const supabase = await createClient();

  const [accounts, allProducts] = await Promise.all([getAccounts(supabase), getAccountProducts(supabase)]);

  // Filtré aux seules références filler : les imports "Croissance par
  // marque" contiennent aussi des lignes non commerciales (bandeaux, cartes
  // implant...) qui remontent comme "marque" et fausseraient les modèles
  // persona (pénétration/quantité médiane calculées sur du bruit) si on ne
  // les excluait pas ici.
  const products = allProducts.filter((p) => isFillerBrand(p.brand));

  // Persona STOCKÉ sur le compte (synchronisé depuis Nexora dans Paramètres).
  const personaByAccount = new Map<string, Persona>();
  for (const a of accounts) {
    if (isPersona(a.persona)) personaByAccount.set(a.id, a.persona);
  }

  const caByAccount = new Map(accounts.map((a) => [a.id, a.ca_2026_ytd ?? 0] as const));
  const models = computePersonaModels(personaByAccount, products, caByAccount);
  const modelByPersona = new Map(models.map((m) => [m.persona, m] as const));

  // Corrélation produit-à-produit (raffinement de la pénétration ci-dessus,
  // propre à ce que CE compte achète déjà plutôt qu'à la moyenne du persona)
  // — voir lib/persona.ts.
  const rulesByPersona = computeAssociationRules(personaByAccount, products);

  // marques achetées par compte
  const brandsByAccount = new Map<string, Set<string>>();
  for (const p of products) {
    if ((p.qty_ordered_cy ?? 0) <= 0) continue;
    const set = brandsByAccount.get(p.account_id) ?? new Set<string>();
    set.add(p.brand);
    brandsByAccount.set(p.account_id, set);
  }

  const rows: PersonaAccountRow[] = accounts
    // Un compte perdu n'a pas sa place dans une liste de recommandations —
    // ses statistiques d'achat passées restent utiles aux modèles persona
    // ci-dessus (plus de données = règles plus robustes), mais lui proposer
    // du cross-sell n'a aucun sens.
    .filter((a) => a.status !== "lost" && isPersona(a.persona))
    .map((a) => {
      const persona = personaByAccount.get(a.id)!;
      const accountBrands = brandsByAccount.get(a.id) ?? new Set<string>();
      return {
        id: a.id,
        name: a.name,
        persona,
        ca: a.ca_2026_ytd ?? 0,
        recos: personaRecommendations(modelByPersona.get(persona), accountBrands).map((b) => b.brand),
        crossSell: crossSellRecommendations(rulesByPersona.get(persona), accountBrands).map((r) => ({
          brand: r.to,
          reason: `Achète déjà ${r.from} (+${Math.round((r.confidence - r.supportTo) * 100)} pts vs base du persona)`,
        })),
      };
    });

  return (
    <PageShell
      title="Personas"
      subtitle="Profils d'achat type par spécialité — pour orienter les recommandations et préparer les trimestres"
    >
      <PersonaClient models={models} rows={rows} />
    </PageShell>
  );
}
