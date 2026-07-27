import { TopBar } from "@/components/layout/TopBar";
import { PersonaClient } from "@/components/personas/PersonaClient";
import type { PersonaAccountRow } from "@/components/personas/PersonaClient";
import { createClient } from "@/lib/supabase/server";
import { computePersonaModels, personaRecommendations, PERSONAS, type Persona } from "@/lib/persona";
import type { Account } from "@/types/database";

export const dynamic = "force-dynamic";

function isPersona(v: string | null): v is Persona {
  return v !== null && (PERSONAS as readonly string[]).includes(v);
}

export default async function PersonasPage() {
  const supabase = await createClient();

  const { data: accountsRaw } = await supabase.from("accounts").select("id, name, ca_2026_ytd, persona");
  const accounts = (accountsRaw ?? []) as Pick<Account, "id" | "name" | "ca_2026_ytd" | "persona">[];

  const { data: productsRaw } = await supabase
    .from("account_products")
    .select("account_id, brand, qty_ordered_cy, sales_value_cy");
  const products = (productsRaw ?? []) as {
    account_id: string;
    brand: string;
    qty_ordered_cy: number | null;
    sales_value_cy: number | null;
  }[];

  // Persona STOCKÉ sur le compte (synchronisé depuis Nexora dans Paramètres).
  const personaByAccount = new Map<string, Persona>();
  for (const a of accounts) {
    if (isPersona(a.persona)) personaByAccount.set(a.id, a.persona);
  }

  const caByAccount = new Map(accounts.map((a) => [a.id, a.ca_2026_ytd ?? 0] as const));
  const models = computePersonaModels(personaByAccount, products, caByAccount);
  const modelByPersona = new Map(models.map((m) => [m.persona, m] as const));

  // marques achetées par compte
  const brandsByAccount = new Map<string, Set<string>>();
  for (const p of products) {
    if ((p.qty_ordered_cy ?? 0) <= 0) continue;
    const set = brandsByAccount.get(p.account_id) ?? new Set<string>();
    set.add(p.brand);
    brandsByAccount.set(p.account_id, set);
  }

  const rows: PersonaAccountRow[] = accounts
    .map((a) => {
      const persona = personaByAccount.get(a.id) ?? null;
      const recos = persona
        ? personaRecommendations(modelByPersona.get(persona), brandsByAccount.get(a.id) ?? new Set()).map((b) => b.brand)
        : [];
      return { id: a.id, name: a.name, persona, ca: a.ca_2026_ytd ?? 0, recos };
    })
    .filter((r) => r.persona !== null);

  return (
    <div>
      <TopBar
        title="Personas"
        subtitle="Profils d'achat type par spécialité — pour orienter les recommandations et préparer les trimestres"
      />
      <main className="px-8 py-6">
        <PersonaClient models={models} rows={rows} />
      </main>
    </div>
  );
}
