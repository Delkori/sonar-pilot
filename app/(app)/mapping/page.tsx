import { readFile } from "fs/promises";
import path from "path";
import { TopBar } from "@/components/layout/TopBar";
import { AuraMap } from "@/components/mapping/AuraMap";
import { createClient } from "@/lib/supabase/server";
import type { Account } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function MappingPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("accounts").select("*");
  const accounts = (data ?? []) as Account[];

  const geoRaw = await readFile(path.join(process.cwd(), "public/geo/aura-departements.json"), "utf-8");
  const geo = JSON.parse(geoRaw);

  return (
    <div>
      <TopBar
        title="Mapping Auvergne-Rhône-Alpes"
        subtitle="Lecture géographique du secteur — préparation de tournée terrain"
      />
      <main className="px-8 py-6">
        <AuraMap geo={geo} accounts={accounts} />
      </main>
    </div>
  );
}
