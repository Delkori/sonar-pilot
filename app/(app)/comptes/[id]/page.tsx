import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { AccountActionsPanel } from "@/components/comptes/AccountActionsPanel";
import { ForecastPanel } from "@/components/comptes/ForecastPanel";
import { TargetingScoreCard } from "@/components/comptes/TargetingScoreCard";
import { ObjectivesCard } from "@/components/comptes/ObjectivesCard";
import { EditableAccountCard } from "@/components/comptes/EditableAccountCard";
import { SegmentBadge } from "@/components/ui/Badge";
import { createClient } from "@/lib/supabase/server";
import { formatEUR, formatNumber, formatPct } from "@/lib/utils";
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

  const refsAcheteesCount = products.filter((p) => (p.qty_ordered_cy ?? 0) > 0 || (p.sales_value_cy ?? 0) > 0).length;

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
            <ForecastPanel accountId={id} account={acc} initialForecasts={forecasts} kind="prevision" />
          </Card>

          {hcps.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Médecins (HCP)</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 font-medium">Nom</th>
                      <th className="py-2 font-medium">Seg</th>
                      <th className="py-2 font-medium">RPPS</th>
                      <th className="py-2 font-medium text-right">Potentiel (boîtes)</th>
                      <th className="py-2 font-medium">Contact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hcps.map((h) => (
                      <tr key={h.id} className="border-b border-border last:border-0">
                        <td className="py-2 font-medium text-foreground">{h.name}</td>
                        <td className="py-2"><SegmentBadge segment={h.segment} /></td>
                        <td className="py-2 text-muted-foreground">{h.rpps ?? "—"}</td>
                        <td className="py-2 text-right">{formatNumber(h.potentiel_boites)}</td>
                        <td className="py-2 text-muted-foreground">
                          {h.email && <div>{h.email}</div>}
                          {h.telephone && <div>{h.telephone}</div>}
                          {!h.email && !h.telephone && "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {products.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Données produit</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 font-medium">Marque</th>
                      <th className="py-2 font-medium text-right">CA N-1</th>
                      <th className="py-2 font-medium text-right">CA N</th>
                      <th className="py-2 font-medium text-right">Croissance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="py-2">{p.brand}</td>
                        <td className="py-2 text-right text-muted-foreground">{formatEUR(p.sales_value_ly)}</td>
                        <td className="py-2 text-right">{formatEUR(p.sales_value_cy)}</td>
                        <td className="py-2 text-right">{formatPct(p.growth_rate_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
