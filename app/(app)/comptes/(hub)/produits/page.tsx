import { ProductMatrix } from "@/components/matrice/ProductMatrix";
import { createClient } from "@/lib/supabase/server";
import { getAccountProducts, getAccounts, getMonthlySales } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

export default async function MatricePage() {
  const supabase = await createClient();
  const [accounts, products, monthlySales] = await Promise.all([
    getAccounts(supabase),
    getAccountProducts(supabase),
    getMonthlySales(supabase),
  ]);

  return (
    <>
      <p className="text-sm text-muted-foreground">Qui a acheté quoi — repérez les opportunités de cross-sell en un coup d&apos;œil</p>
      <ProductMatrix accounts={accounts} products={products} monthlySales={monthlySales} />
    </>
  );
}
