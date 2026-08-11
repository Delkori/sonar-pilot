import { TopBar } from "@/components/layout/TopBar";
import { SonarScoreClient } from "@/components/sonarscore/SonarScoreClient";
import { createClient } from "@/lib/supabase/server";
import type { Account, AccountProductPurchase } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function SonarScorePage() {
  const supabase = await createClient();
  const { data: accountsRaw } = await supabase
    .from("accounts")
    .select("id, name, segment, city, price_list, objectif_boites, realise_boites")
    .order("name");
  const accounts = (accountsRaw ?? []) as Pick<
    Account,
    "id" | "name" | "segment" | "city" | "price_list" | "objectif_boites" | "realise_boites"
  >[];

  const { data: purchasesRaw } = await supabase
    .from("account_product_purchases")
    .select("account_id, brand, purchase_date, qty, value_eur");
  const purchases = (purchasesRaw ?? []) as Pick<
    AccountProductPurchase,
    "account_id" | "brand" | "purchase_date" | "qty" | "value_eur"
  >[];

  return (
    <div>
      <TopBar
        title="SonarScore"
        subtitle="Module de scoring comportemental en test — RFM-S, vélocités de réapprovisionnement, matrice contrat, prévision d'achat (en coexistence avec le score de ciblage existant)"
      />
      <main className="px-8 py-6">
        <SonarScoreClient accounts={accounts} purchases={purchases} />
      </main>
    </div>
  );
}
