import { readFile } from "fs/promises";
import path from "path";
import { PageShell } from "@/components/layout/PageShell";
import { AuraMap } from "@/components/mapping/AuraMap";
import { createClient } from "@/lib/supabase/server";
import { getAccountProducts, getAccounts, getHcps } from "@/lib/data/queries";
import { getLabsByRpps } from "@/lib/nexora/queries";

export const dynamic = "force-dynamic";

export default async function MappingPage() {
  const supabase = await createClient();

  const [accounts, products, hcps, geoRaw] = await Promise.all([
    getAccounts(supabase),
    getAccountProducts(supabase),
    getHcps(supabase),
    readFile(path.join(process.cwd(), "public/geo/aura-departements.json"), "utf-8"),
  ]);
  const geo = JSON.parse(geoRaw);

  // Comptes dont un médecin rattaché est sponsorisé par un labo donné
  // (ex: Allergan) — croisement RPPS local / base Transparence Santé
  // (Nexora), pour surfacer ces comptes/prospects directement sur la carte.
  const rppsList = Array.from(new Set(hcps.map((h) => h.rpps).filter((r): r is string => !!r)));
  const labsByRpps = rppsList.length > 0 ? await getLabsByRpps(rppsList) : [];

  const accountIdsByRpps = new Map<string, string[]>();
  for (const h of hcps) {
    if (!h.rpps || !h.account_id) continue;
    const arr = accountIdsByRpps.get(h.rpps);
    if (arr) arr.push(h.account_id);
    else accountIdsByRpps.set(h.rpps, [h.account_id]);
  }

  const sponsoredAccountsByLab = new Map<string, Set<string>>();
  for (const l of labsByRpps) {
    const accountIds = accountIdsByRpps.get(l.rpps);
    if (!accountIds?.length) continue;
    const set = sponsoredAccountsByLab.get(l.nom_labo) ?? new Set<string>();
    accountIds.forEach((id) => set.add(id));
    sponsoredAccountsByLab.set(l.nom_labo, set);
  }
  const sponsoringLabs = Array.from(sponsoredAccountsByLab.entries())
    .map(([lab, ids]) => ({ lab, accountIds: Array.from(ids) }))
    .sort((a, b) => b.accountIds.length - a.accountIds.length);

  return (
    <PageShell
      title="Mapping Auvergne-Rhône-Alpes"
      subtitle="Lecture géographique du secteur — préparation de tournée terrain"
    >
      <AuraMap geo={geo} accounts={accounts} products={products} hcps={hcps} sponsoringLabs={sponsoringLabs} />
    </PageShell>
  );
}
