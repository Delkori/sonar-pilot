export type Segment = "A" | "B" | "C" | "D" | "E";
export type AccountStatus =
  | "actif"
  | "lost"
  | "new"
  | "reconnected"
  | "a_risque"
  | "a_suivre";

// NB: these are `type` aliases, not `interface` — the Supabase generic
// client's deeply nested conditional types fail to resolve (collapse to
// `never`) when the Row/Insert/Update shapes come from `interface`
// declarations instead of `type`. Keep these as `type`.

export type Account = {
  id: string;
  external_ref: string;
  name: string;
  segment: Segment | null;
  status: AccountStatus;
  price_list: string | null;
  owner: string | null;
  hco_type: string | null;
  city: string | null;
  postal_code: string | null;
  region: string;
  department_code: string | null;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  potentiel_boites: number | null;
  ca_2022: number | null;
  ca_2023: number | null;
  ca_2024: number | null;
  ca_2025: number | null;
  ca_2026_ytd: number | null;
  objectif_boites: number | null;
  realise_boites: number | null;
  score: number | null;
  jours_silence: number | null;
  evolution_pct: number | null;
  action_recommandee: string | null;
  refs_manquantes: string | null;
  nb_refs_achetees_2025: number | null;
  last_call_date: string | null;
  days_since_last_call: number | null;
  first_order_date: string | null;
  last_order_date: string | null;
  import_id: string | null;
  email: string | null;
  telephone: string | null;
  nom_concurrent: string | null;
  objectif_filler: number | null;
  objectif_cosmetique: number | null;
  created_at: string;
  updated_at: string;
};

export type Import = {
  id: string;
  filename: string;
  source: "PAS" | "SALESFORCE" | "KPI" | "CALLS" | "GROWTH_BY_BRAND" | "PRODUCTS";
  imported_at: string;
  imported_by: string | null;
  status: "success" | "partial" | "failed";
  rows_total: number;
  rows_success: number;
  rows_error: number;
  log: { row: number; message: string }[];
};

export type AccountAction = {
  id: string;
  account_id: string;
  type: "commentaire" | "action" | "relance" | "offre";
  content: string;
  due_date: string | null;
  done: boolean;
  created_by: string | null;
  created_at: string;
};

export type AccountProduct = {
  id: string;
  account_id: string;
  brand: string;
  sales_value_ly: number | null;
  sales_value_cy: number | null;
  qty_ordered_ly: number | null;
  qty_ordered_cy: number | null;
  growth_rate_pct: number | null;
  period: string | null;
  updated_at: string;
};

export type TerritoryObjective = {
  id: string;
  department_code: string;
  department_name: string;
  objectif_ca: number;
  objectif_boites: number;
  quarter: string;
  updated_at: string;
};

export type AccountMonthlySale = {
  id: string;
  account_id: string;
  year: number;
  month: number;
  ca: number;
  updated_at: string;
};

export type ForecastKind = "objectif" | "prevision" | "realise";

export type AccountForecast = {
  id: string;
  account_id: string;
  year: number;
  month: number;
  kind: ForecastKind;
  boites_prevues: number | null;
  ca_prevu: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type NameAlias = {
  id: string;
  raw_name: string;
  account_id: string;
  confidence: number | null;
  created_at: string;
};

export type NameMatchCandidate = {
  id: string;
  raw_name: string;
  candidate_account_id: string | null;
  candidate_name: string | null;
  confidence: number | null;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
  updated_at: string;
};

export type Hcp = {
  id: string;
  account_id: string | null;
  external_ref: string;
  name: string;
  rpps: string | null;
  segment: Segment | null;
  potentiel_boites: number | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  email: string | null;
  telephone: string | null;
  nom_concurrent: string | null;
  created_at: string;
  updated_at: string;
};

export type HcpSponsorship = {
  id: string;
  rpps: string | null;
  hcp_name: string | null;
  laboratoire: string | null;
  montant: number | null;
  annee: number | null;
  type: string | null;
  structure_nom: string | null;
  departement: string | null;
  specialite: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export type CalendarFeedToken = {
  token: string;
  created_at: string;
};

// Minimal Database type for the Supabase client generics. Run
// `supabase gen types typescript` against the real project to replace this
// with a fully generated definition once the schema is applied.
type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      accounts: Table<Account>;
      imports: Table<Import>;
      account_actions: Table<AccountAction>;
      account_products: Table<AccountProduct>;
      territory_objectives: Table<TerritoryObjective>;
      account_monthly_sales: Table<AccountMonthlySale>;
      account_forecasts: Table<AccountForecast>;
      name_aliases: Table<NameAlias>;
      name_match_candidates: Table<NameMatchCandidate>;
      calendar_feed_tokens: Table<CalendarFeedToken>;
      hcps: Table<Hcp>;
      hcp_sponsorships: Table<HcpSponsorship>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
