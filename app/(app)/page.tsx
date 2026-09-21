import { PageShell } from "@/components/layout/PageShell";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import type { ChanceRow } from "@/components/dashboard/OrderChancesCard";
import { createClient } from "@/lib/supabase/server";
import {
  getAccounts,
  getAccountProducts,
  getDashboardLayout,
  getForecasts,
  getLastImportLabel,
  getMonthlySales,
  getPlanningEvents,
  getPurchaseLines,
  getSectorObjectives,
} from "@/lib/data/queries";
import { getCompetitorAmounts, SECTEUR_REGION } from "@/lib/nexora/queries";
import { buildProbabilityModel } from "@/lib/probability";
import { normalizeLayout } from "@/lib/dashboard-layout";
import { parisDateParts } from "@/lib/appointments";

export const dynamic = "force-dynamic";

const HORIZON_CHANCES = 3;

export default async function DashboardPage() {
  const supabase = await createClient();

  // Requêtes indépendantes : en série, la page attendait la somme des
  // latences Supabase avant le premier octet.
  const [accounts, monthlySales, products, forecasts, sectorObjectives, lastImportLabel, purchaseLines, planningEvents, layoutRaw] =
    await Promise.all([
      getAccounts(supabase),
      getMonthlySales(supabase),
      getAccountProducts(supabase),
      getForecasts(supabase, "prevision"),
      getSectorObjectives(supabase),
      getLastImportLabel(supabase),
      getPurchaseLines(supabase),
      getPlanningEvents(supabase),
      getDashboardLayout(supabase),
    ]);

  // Objectifs du secteur (saisis dans Paramètres) — remis au format
  // attendu par le graphique Objectif vs Réalisé.
  const objectifs = sectorObjectives.map((o) => ({
    account_id: "",
    year: o.year,
    month: o.month,
    boites_prevues: o.objectif_boites,
    ca_prevu: o.objectif_ca,
  }));

  const competitorAmounts = await getCompetitorAmounts(SECTEUR_REGION);

  // Chances de commande à 3 mois : le modèle s'apprend ici, seules les
  // lignes de tête (sérialisables) partent au navigateur.
  const model = buildProbabilityModel({ accounts, monthlySales, purchaseLines, forecasts, horizon: HORIZON_CHANCES });
  const lost = new Set(accounts.filter((a) => a.status === "lost").map((a) => a.id));
  const nameById = new Map(accounts.map((a) => [a.id, a.name] as const));
  const chances: ChanceRow[] = model.accounts
    .filter((r) => !lost.has(r.accountId))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 10)
    .map((r) => ({
      accountId: r.accountId,
      name: nameById.get(r.accountId) ?? r.accountId,
      probability: r.probability,
      expectedCa: r.expectedCa,
      lastOrder: r.lastOrder,
      factor: r.factors.find((f) => f.weight > 0)?.levelLabel ?? r.factors[0]?.levelLabel ?? "",
    }));

  const now = parisDateParts(new Date().toISOString())!;
  const today = `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`;

  return (
    <PageShell title="Dashboard" subtitle="Secteur Auvergne-Rhône-Alpes" bare>
      <DashboardClient
        accounts={accounts}
        monthlySales={monthlySales}
        products={products}
        forecasts={forecasts}
        objectifs={objectifs}
        competitorAmounts={competitorAmounts}
        lastImportLabel={lastImportLabel}
        chances={chances}
        chancesHorizon={HORIZON_CHANCES}
        planningEvents={planningEvents.map((e) => ({
          id: e.id,
          account_id: e.account_id,
          type: e.type,
          title: e.title,
          start_at: e.start_at,
          confirmed: e.confirmed,
        }))}
        today={today}
        initialLayout={normalizeLayout(layoutRaw)}
      />
    </PageShell>
  );
}
