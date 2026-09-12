import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetchAll";
import type {
  Account,
  AccountAction,
  AccountForecast,
  AccountProductPurchase,
  ForecastKind,
  Hcp,
  HcpSponsorship,
  PlanningEvent,
  SectorObjective,
} from "@/types/database";

/**
 * Couche d'accès aux données des pages serveur.
 *
 * Chaque page réécrivait sa propre variante des mêmes six requêtes
 * (`from("accounts").select("*")`, ventes mensuelles, produits, prévisions…),
 * chacune avec sa liste de colonnes, son cast et son `?? []`. Résultat :
 * une correction (pagination, filtre, colonne ajoutée) devait être répétée
 * dans 8 fichiers, et ne l'était jamais partout. Tout est regroupé ici, et
 * tout passe par `fetchAll` — donc plus aucune lecture tronquée à 1000
 * lignes.
 */

type Db = Awaited<ReturnType<typeof createClient>>;

/** Sous-ensemble de colonnes suffisant partout où l'on agrège les ventes. */
export type MonthlySaleRow = { account_id: string; year: number; month: number; ca: number };

export type ProductRow = {
  account_id: string;
  brand: string;
  sales_value_ly: number | null;
  sales_value_cy: number | null;
  qty_ordered_ly: number | null;
  qty_ordered_cy: number | null;
  growth_rate_pct: number | null;
};

export type PurchaseRow = Pick<
  AccountProductPurchase,
  "account_id" | "brand" | "purchase_date" | "qty" | "value_eur"
>;

export type HcpLite = Pick<Hcp, "id" | "account_id" | "name" | "rpps" | "potentiel_boites">;

export async function getAccounts(db: Db): Promise<Account[]> {
  return fetchAll<Account>(() => db.from("accounts").select("*"), { orderBy: "name" });
}

export async function getMonthlySales(db: Db): Promise<MonthlySaleRow[]> {
  return fetchAll<MonthlySaleRow>(() =>
    db.from("account_monthly_sales").select("account_id, year, month, ca")
  );
}

export async function getAccountProducts(db: Db): Promise<ProductRow[]> {
  return fetchAll<ProductRow>(() =>
    db
      .from("account_products")
      .select(
        "account_id, brand, sales_value_ly, sales_value_cy, qty_ordered_ly, qty_ordered_cy, growth_rate_pct"
      )
  );
}

export async function getForecasts(db: Db, kind: ForecastKind = "prevision"): Promise<AccountForecast[]> {
  return fetchAll<AccountForecast>(() => db.from("account_forecasts").select("*").eq("kind", kind));
}

export async function getPurchaseLines(db: Db): Promise<PurchaseRow[]> {
  return fetchAll<PurchaseRow>(() =>
    db.from("account_product_purchases").select("account_id, brand, purchase_date, qty, value_eur")
  );
}

export async function getActions(db: Db, types?: AccountAction["type"][]): Promise<AccountAction[]> {
  return fetchAll<AccountAction>(() => {
    const q = db.from("account_actions").select("*");
    return types ? q.in("type", types) : q;
  });
}

export async function getHcps(db: Db): Promise<HcpLite[]> {
  return fetchAll<HcpLite>(() => db.from("hcps").select("id, account_id, name, rpps, potentiel_boites"));
}

export async function getPlanningEvents(db: Db): Promise<PlanningEvent[]> {
  return fetchAll<PlanningEvent>(() => db.from("planning_events").select("*"), { orderBy: "start_at" });
}

export async function getSponsorships(db: Db): Promise<HcpSponsorship[]> {
  return fetchAll<HcpSponsorship>(() => db.from("hcp_sponsorships").select("*"));
}

export async function getSectorObjectives(db: Db): Promise<SectorObjective[]> {
  return fetchAll<SectorObjective>(() => db.from("sector_objectives").select("*"));
}

/** Nombre de correspondances de nom restant à arbitrer manuellement. */
export async function getPendingMatchCount(db: Db): Promise<number> {
  const { count } = await db
    .from("name_match_candidates")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

/** Phrase de fraîcheur des données affichée en tête de dashboard. */
export async function getLastImportLabel(db: Db): Promise<string> {
  const { data } = await db
    .from("imports")
    .select("imported_at, filename")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return "Aucun import réalisé pour le moment — rendez-vous dans Paramètres › Import";
  return `Dernière mise à jour : ${new Date(data.imported_at).toLocaleString("fr-FR")} (${data.filename})`;
}
