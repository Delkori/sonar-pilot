import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { AccountActionsPanel } from "@/components/comptes/AccountActionsPanel";
import { ForecastPanel } from "@/components/comptes/ForecastPanel";
import { TargetingScoreCard } from "@/components/comptes/TargetingScoreCard";
import { ObjectivesCard } from "@/components/comptes/ObjectivesCard";
import { EditableAccountCard } from "@/components/comptes/EditableAccountCard";
import { HcpTable } from "@/components/comptes/HcpTable";
import { ProductsTable } from "@/components/comptes/ProductsTable";
import { OrderHistoryCard } from "@/components/comptes/OrderHistoryCard";
import { SponsorshipCard } from "@/components/comptes/SponsorshipCard";
import type { SponsorshipRow } from "@/components/comptes/SponsorshipCard";
import { allocateToHcps } from "@/lib/forecast";
import { getLabsByRpps } from "@/lib/nexora/queries";
import { createClient } from "@/lib/supabase/server";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { Account, AccountAction, AccountForecast, AccountProduct, Hcp } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FicheComptePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: account } = await supabase.from("accounts").select("*").eq("id", id).single();
  if (!account) notFound();
  const acc = account as Account;

  const { data: actionsRaw } = await supabase
    .from("account_actions")
    .select("*")
    .eq("account_id", id)
    .order("created_at", { ascending: false });
  const actions = (actionsRaw ?? []) as AccountAction[];

  const { data: productsRaw } = await supabase.from("account_products").select("*").eq("account_id", id);
  const products = (productsRaw ?? []) as AccountProduct[];

  const { data: forecastsRaw } = await supabase.from("account_forecasts").select("*").eq("account_id", id);
  const forecasts = (forecastsRaw ?? []) as AccountForecast[];

  const { data: hcpsRaw } = await supabase.from("hcps").select("*").eq("account_id", id).order("name");
  const hcps = (hcpsRaw ?? []) as Hcp[];

  const { data: monthlyRaw } = await supabase
    .from("account_monthly_sales")
    .select("year, month, ca")
    .eq("account_id", id);
  const monthlySales = (monthlyRaw ?? []) as { year: number; month: number; ca: number }[];

  // Sponsoring des médecins du compte, en direct depuis la base Transparence
  // Santé (Nexora), rapproché via le RPPS.
  const rppsList = hcps.map((h) => h.rpps).filter((r): r is string => !!r);
  const nameByRpps = new Map(hcps.filter((h) => h.rpps).map((h) => [h.rpps as string, h.name] as const));
  const labs = await getLabsByRpps(rppsList);
  const sponsorships: SponsorshipRow[] = labs.map((l, i) => ({
    id: `${l.rpps}-${i}`,
    medecin: nameByRpps.get(l.rpps) ?? l.rpps,
    laboratoire: l.nom_labo,
    montant: l.montant,
  }));

  const refsAcheteesCount = products.filter((p) => (p.qty_ordered_cy ?? 0) > 0 || (p.sales_value_cy ?? 0) > 0).length;

  // Répartition de la prévision à venir (mois >= mois courant) sur les médecins
  // du compte, au prorata de leur potentiel — pour que "les médecins dans le
  // mois aient une prévision" jusque dans la fiche.
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + (now.getMonth() + 1);
  const upcomingPrevision = forecasts
    .filter((f) => f.kind === "prevision" && f.year * 12 + f.month >= nowIdx)
    .reduce(
      (acc, f) => {
        acc.boites += f.boites_prevues ?? 0;
        acc.ca += f.ca_prevu ?? 0;
        return acc;
      },
      { boites: 0, ca: 0 }
    );
  const hcpAllocation = new Map<string, { boites: number; ca: number }>();
  if ((upcomingPrevision.ca > 0 || upcomingPrevision.boites > 0) && hcps.length > 0) {
    for (const share of allocateToHcps(
      hcps.map((h) => ({ id: h.id, name: h.name, potentiel_boites: h.potentiel_boites })),
      upcomingPrevision.boites,
      upcomingPrevision.ca
    )) {
      hcpAllocation.set(share.hcpId, { boites: share.boites, ca: share.ca });
    }
  }

  return (
    <div>
      <TopBar title={acc.name} subtitle={`${acc.external_ref} · ${acc.city ?? "Ville inconnue"} ${acc.postal_code ?? ""}`} />

      <main className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <TargetingScoreCard account={acc} refsAcheteesCount={products.length > 0 ? refsAcheteesCount : undefined} />

          <Card>
            <CardHeader><CardTitle>Compte</CardTitle></CardHeader>
            <CardContent>
              <EditableAccountCard account={acc} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Autres informations</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Liste de prix" value={acc.price_list ?? "—"} />
              <Row label="Type" value={acc.hco_type ?? "—"} />
              <Row label="Potentiel (boîtes)" value={formatNumber(acc.potentiel_boites)} />
              <Row label="Silence (jours)" value={formatNumber(acc.jours_silence)} />
              <Row label="Dernier appel" value={acc.last_call_date ? new Date(acc.last_call_date).toLocaleDateString("fr-FR") : "—"} />
              {acc.persona && <Row label="Persona" value={acc.persona} />}
              {acc.nom_concurrent && <Row label="Concurrent" value={acc.nom_concurrent} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Objectifs</CardTitle></CardHeader>
            <CardContent>
              <ObjectivesCard account={acc} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Historique CA</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="CA 2024" value={formatEUR(acc.ca_2024)} />
              <Row label="CA 2025" value={formatEUR(acc.ca_2025)} />
              <Row label="CA 2026 YTD" value={formatEUR(acc.ca_2026_ytd)} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>Commentaires &amp; plan d&apos;action</CardTitle></CardHeader>
            <AccountActionsPanel accountId={id} initialActions={actions} />
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Objectifs mensuels</CardTitle>
            </CardHeader>
            <ForecastPanel accountId={id} account={acc} initialForecasts={forecasts} kind="objectif" />
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Prévisionnel mensuel</CardTitle>
            </CardHeader>
            <ForecastPanel accountId={id} account={acc} initialForecasts={forecasts} kind="prevision" monthlySales={monthlySales} />
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Réalisé mensuel</CardTitle>
            </CardHeader>
            <ForecastPanel accountId={id} account={acc} initialForecasts={forecasts} kind="realise" monthlySales={monthlySales} />
          </Card>

          <OrderHistoryCard sales={monthlySales} />

          {hcps.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Médecins (HCP)</CardTitle></CardHeader>
              <CardContent>
                <HcpTable hcps={hcps} allocation={hcpAllocation} />
              </CardContent>
            </Card>
          )}

          {sponsorships.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Sponsoring (Nexora)</CardTitle>
              </CardHeader>
              <CardContent>
                <SponsorshipCard rows={sponsorships} />
              </CardContent>
            </Card>
          )}

          {products.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Données produit</CardTitle></CardHeader>
              <CardContent>
                <ProductsTable products={products} />
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

function Row({ label, value, valueClassName = "" }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium text-foreground ${valueClassName}`}>{value}</span>
    </div>
  );
}
