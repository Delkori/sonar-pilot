import { TopBar } from "@/components/layout/TopBar";
import { ProductMatrix } from "@/components/matrice/ProductMatrix";
import { createClient } from "@/lib/supabase/server";
import type { Account } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function MatricePage() {
  const supabase = await createClient();
  const { data: accountsRaw } = await supabase.from("accounts").select("*").order("name");
  const accounts = (accountsRaw ?? []) as Account[];

  const { data: productsRaw } = await supabase
    .from("account_products")
    .select("account_id, brand, qty_ordered_cy, sales_value_cy, qty_ordered_ly, sales_value_ly");
  const products = productsRaw ?? [];

  return (
    <div>
      <TopBar
        title="Matrice Client × Produit"
        subtitle="Qui a acheté quoi — repérez les opportunités de cross-sell en un coup d'œil"
      />
      <main className="px-8 py-6">
        <ProductMatrix accounts={accounts} products={products} />
      </main>
    </div>
  );
}
