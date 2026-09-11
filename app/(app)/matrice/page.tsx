import { PageShell } from "@/components/layout/PageShell";
import { ProductMatrix } from "@/components/matrice/ProductMatrix";
import { createClient } from "@/lib/supabase/server";
import { getAccountProducts, getAccounts } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

export default async function MatricePage() {
  const supabase = await createClient();
  const [accounts, products] = await Promise.all([getAccounts(supabase), getAccountProducts(supabase)]);

  return (
    <PageShell
      title="Matrice Client × Produit"
      subtitle="Qui a acheté quoi — repérez les opportunités de cross-sell en un coup d'œil"
    >
      <ProductMatrix accounts={accounts} products={products} />
    </PageShell>
  );
}
