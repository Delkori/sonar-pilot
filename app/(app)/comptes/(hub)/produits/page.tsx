import { ProductMatrix } from "@/components/matrice/ProductMatrix";
import { PersonaClient } from "@/components/personas/PersonaClient";
import type { PersonaAccountRow } from "@/components/personas/PersonaClient";
import { createClient } from "@/lib/supabase/server";
import { getAccountProducts, getAccounts, getMonthlySales } from "@/lib/data/queries";
import {
  computePersonaModels,
  personaRecommendations,
  computeAssociationRules,
  crossSellRecommendations,
  PERSONAS,
  type Persona,
} from "@/lib/persona";
import { isFillerBrand } from "@/lib/brands";
import { revenueByAccountYear, revenueForYear } from "@/lib/revenue";

export const dynamic = "force-dynamic";

function isPersona(v: string | null): v is Persona {
  return v !== null && (PERSONAS as readonly string[]).includes(v);
}

/**
 * Qui achète quoi — et quoi proposer à qui. La matrice produit (qui a
 * acheté quoi, références vs N-1) et les personas (ce que les pairs d'un
 * même profil achètent, et ce qui manque à chaque compte) répondent à la
 * même question de préparation de visite : elles vivent sur la même page.
 */
export default async function ProduitsPage() {
  const supabase = await createClient();
  const [accounts, allProducts, monthlySales] = await Promise.all([
    getAccounts(supabase),
    getAccountProducts(supabase),
    getMonthlySales(supabase),
  ]);

  // CA de l'exercice en cours, mesuré : `ca_2026_ytd` aurait cessé de
  // désigner l'année en cours au 1er janvier 2027.
  const anneeEnCours = new Date().getFullYear();
  const caParAnnee = revenueByAccountYear(monthlySales);
  const caCourant = (a: (typeof accounts)[number]) => revenueForYear(a, anneeEnCours, caParAnnee);

  // Personas calculés sur les seules références filler : les imports
  // « Croissance par marque » contiennent aussi des lignes non commerciales
  // (bandeaux, cartes implant…) qui fausseraient pénétration et quantités.
  const fillers = allProducts.filter((p) => isFillerBrand(p.brand));
  const personaByAccount = new Map<string, Persona>();
  for (const a of accounts) if (isPersona(a.persona)) personaByAccount.set(a.id, a.persona);
  const caByAccount = new Map(accounts.map((a) => [a.id, caCourant(a)] as const));
  const models = computePersonaModels(personaByAccount, fillers, caByAccount);
  const modelByPersona = new Map(models.map((m) => [m.persona, m] as const));
  const rulesByPersona = computeAssociationRules(personaByAccount, fillers);

  const brandsByAccount = new Map<string, Set<string>>();
  for (const p of fillers) {
    if ((p.qty_ordered_cy ?? 0) <= 0) continue;
    const set = brandsByAccount.get(p.account_id) ?? new Set<string>();
    set.add(p.brand);
    brandsByAccount.set(p.account_id, set);
  }

  const rows: PersonaAccountRow[] = accounts
    // Un compte perdu n'a pas sa place dans une liste de recommandations.
    .filter((a) => a.status !== "lost" && isPersona(a.persona))
    .map((a) => {
      const persona = personaByAccount.get(a.id)!;
      const accountBrands = brandsByAccount.get(a.id) ?? new Set<string>();
      return {
        id: a.id,
        name: a.name,
        persona,
        ca: caCourant(a),
        recos: personaRecommendations(modelByPersona.get(persona), accountBrands).map((b) => b.brand),
        crossSell: crossSellRecommendations(rulesByPersona.get(persona), accountBrands).map((r) => ({
          brand: r.to,
          reason: `Achète déjà ${r.from} (+${Math.round((r.confidence - r.supportTo) * 100)} pts vs base du persona)`,
        })),
      };
    });

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Qui a acheté quoi — repérez les opportunités de cross-sell en un coup d&apos;œil ; plus bas, ce que les pairs de
        chaque persona achètent et ce qui manque à chaque compte.
      </p>
      <ProductMatrix accounts={accounts} products={allProducts} monthlySales={monthlySales} />
      <section id="personas" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Personas — profils d&apos;achat par spécialité</h2>
          <p className="text-xs text-muted-foreground">
            Dermatologues, chirurgiens plasticiens, médecins esthétiques : le modèle type de chacun, et pour chaque
            compte les références que ses pairs achètent et qu&apos;il n&apos;a pas encore. Le persona se synchronise
            depuis Paramètres.
          </p>
        </div>
        <PersonaClient models={models} rows={rows} />
      </section>
    </>
  );
}
