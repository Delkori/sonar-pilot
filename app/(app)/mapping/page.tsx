import { readFile } from "fs/promises";
import path from "path";
import { TopBar } from "@/components/layout/TopBar";
import { AuraMap } from "@/components/mapping/AuraMap";
import { createClient } from "@/lib/supabase/server";
import { getLabsByRpps } from "@/lib/nexora/queries";
import type { Account } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function MappingPage() {
  const supabase = await createClient();
  const { data: accountsRaw } = await supabase.from("accounts").select("*");
  const accounts = (accountsRaw ?? []) as Account[];

  const { data: productsRaw } = await supabase
    .from("account_products")
    .select("account_id, brand, sales_value_ly, sales_value_cy, qty_ordered_ly, qty_ordered_cy");
  const products = productsRaw ?? [];

  const { data: hcpsRaw } = await supabase.from("hcps").select("account_id, name, rpps");
  const hcps = (hcpsRaw ?? []) as { account_id: string | null; name: string; rpps: string | null }[];

  // Comptes dont un médecin rattaché est sponsorisé par un labo donné
  // (ex: Allergan) — croisement RPPS local / base Transparence Santé
  // (Nexora), pour surfacer ces comptes/prospects directement sur la carte.
  const rppsList = Array.from(new Set(hcps.map((h) => h.rpps).filter((r): r is string => !!r)));
  const labsByRpps = rppsList.length > 0 ? await getLabsByRpps(rppsList) : [];
  const sponsoredAccountsByLab = new Map<string, Set<string>>();
  for (const l of labsByRpps) {
    const accountIds = hcps.filter((h) => h.rpps === l.rpps && h.account_id).map((h) => h.account_id as string);
    if (accountIds.length === 0) continue;
    const set = sponsoredAccountsByLab.get(l.nom_labo) ?? new Set<string>();
    accountIds.forEach((id) => set.add(id));
    sponsoredAccountsByLab.set(l.nom_labo, set);
  }
  const sponsoringLabs = Array.from(sponsoredAccountsByLab.entries())
    .map(([lab, ids]) => ({ lab, accountIds: Array.from(ids) }))
    .sort((a, b) => b.accountIds.length - a.accountIds.length);

  const geoRaw = await readFile(path.join(process.cwd(), "public/geo/aura-departements.json"), "utf-8");
  const geo = JSON.parse(geoRaw);

  return (
    <div>
      <TopBar
        title="Mapping Auvergne-Rhône-Alpes"
        subtitle="Lecture géographique du secteur — préparation de tournée terrain"
      />
      <main className="px-8 py-6">
        <AuraMap geo={geo} accounts={accounts} products={products} hcps={hcps} sponsoringLabs={sponsoringLabs} />
      </main>
    </div>
  );
}
