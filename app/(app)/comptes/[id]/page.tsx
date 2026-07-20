import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { SegmentBadge, StatusBadge } from "@/components/ui/Badge";
import { AccountActionsPanel } from "@/components/comptes/AccountActionsPanel";
import { createClient } from "@/lib/supabase/server";
import { formatEUR, formatNumber, formatPct } from "@/lib/utils";
import type { Account, AccountAction, AccountProduct } from "@/types/database";

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

  const ecart = (acc.realise_boites ?? 0) - (acc.objectif_boites ?? 0);
  const atteinte = acc.objectif_boites ? (acc.realise_boites ?? 0) / acc.objectif_boites : 0;

  return (
    <div>
      <TopBar title={acc.name} subtitle={`${acc.external_ref} · ${acc.city ?? "Ville inconnue"} ${acc.postal_code ?? ""}`} />

      <main className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Compte</CardTitle>
              <div className="flex gap-2">
                <SegmentBadge segment={acc.segment} />
                <StatusBadge status={acc.status} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Liste de prix" value={acc.price_list ?? "—"} />
              <Row label="Commercial" value={acc.owner ?? "—"} />
              <Row label="Type" value={acc.hco_type ?? "—"} />
              <Row label="Potentiel (boîtes)" value={formatNumber(acc.potentiel_boites)} />
              <Row label="Score" value={formatNumber(acc.score)} />
              <Row label="Silence (jours)" value={formatNumber(acc.jours_silence)} />
              <Row label="Dernier appel" value={acc.last_call_date ? new Date(acc.last_call_date).toLocaleDateString("fr-FR") : "—"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Objectif / Réalisé / Écart</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Objectif (boîtes)" value={formatNumber(acc.objectif_boites)} />
              <Row label="Réalisé (boîtes)" value={formatNumber(acc.realise_boites)} />
              <Row
                label="Écart"
                value={`${ecart > 0 ? "+" : ""}${formatNumber(ecart)}`}
                valueClassName={ecart < 0 ? "text-danger" : "text-success"}
              />
              <Row label="% Atteinte" value={formatPct(atteinte)} />
              <Row label="Évolution 25→26" value={formatPct(acc.evolution_pct)} />
              {acc.action_recommandee && (
                <div className="mt-3 rounded-lg bg-primary-50 px-3 py-2 text-primary-700">
                  {acc.action_recommandee}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Historique CA</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="CA 2022" value={formatEUR(acc.ca_2022)} />
              <Row label="CA 2023" value={formatEUR(acc.ca_2023)} />
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
                        <td className="py-2 text-right">{formatPct(p.growth_rate_pct ? p.growth_rate_pct / 100 : null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {acc.refs_manquantes && (
            <Card>
              <CardHeader><CardTitle>Références manquantes</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">{acc.refs_manquantes}</CardContent>
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
