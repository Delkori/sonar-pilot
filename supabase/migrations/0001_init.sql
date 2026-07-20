-- Sonar Pilot — schema initial
-- Source de vérité pour le secteur commercial Auvergne-Rhône-Alpes,
-- alimentée par import Excel (PAS Q3 2026, KPI mensuel, Calls, Growth by Brand).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- accounts : un compte = une ligne "SUIVI COMPTES" enrichie du KPI mensuel
-- ---------------------------------------------------------------------------
create table accounts (
  id uuid primary key default gen_random_uuid(),
  external_ref text not null unique,            -- CODE SAP / Code client
  name text not null,                            -- NOM DU COMPTE

  segment text check (segment in ('A','B','C','D','E')),
  status text check (status in ('actif','lost','new','reconnected','a_risque','a_suivre')) default 'a_suivre',

  price_list text,                               -- PARTENAIRES (Start / Premium / Pro+ ...)
  owner text,                                    -- Nom du commercial
  hco_type text,                                 -- HCO type / Channel

  city text,                                     -- Ville
  postal_code text,                              -- Code Postal
  region text not null default 'Auvergne-Rhône-Alpes',
  department_code text,                          -- déduit du code postal (2 premiers chiffres)
  latitude double precision,
  longitude double precision,
  geocoded_at timestamptz,

  potentiel_boites numeric,                      -- POT. (boîtes)
  ca_2022 numeric,
  ca_2023 numeric,
  ca_2024 numeric,
  ca_2025 numeric,
  ca_2026_ytd numeric,

  objectif_boites numeric,                       -- BOITES A FAIRE
  realise_boites numeric,                        -- NB BOITES 2026
  score numeric,                                 -- SCORE
  jours_silence integer,                         -- SILENCE
  evolution_pct numeric,                         -- ÉVOL 25→26
  action_recommandee text,                       -- ACTION
  refs_manquantes text,                          -- RÉFS MANQUANTES 2025

  last_call_date date,                           -- Calls By Customer
  days_since_last_call integer,
  first_order_date date,
  last_order_date date,

  import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index accounts_segment_idx on accounts (segment);
create index accounts_status_idx on accounts (status);
create index accounts_postal_code_idx on accounts (postal_code);
create index accounts_department_code_idx on accounts (department_code);

-- ---------------------------------------------------------------------------
-- imports : traçabilité de chaque chargement Excel
-- ---------------------------------------------------------------------------
create table imports (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  source text not null,                          -- 'PAS' | 'KPI' | 'CALLS' | 'GROWTH_BY_BRAND' | 'PRODUCTS'
  imported_at timestamptz not null default now(),
  imported_by text,
  status text not null check (status in ('success','partial','failed')) default 'success',
  rows_total integer not null default 0,
  rows_success integer not null default 0,
  rows_error integer not null default 0,
  log jsonb not null default '[]'::jsonb
);

alter table accounts
  add constraint accounts_import_id_fkey foreign key (import_id) references imports(id) on delete set null;

-- ---------------------------------------------------------------------------
-- account_actions : commentaires + plan d'action commercial
-- ---------------------------------------------------------------------------
create table account_actions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  type text not null check (type in ('commentaire','action','relance')) default 'commentaire',
  content text not null,
  due_date date,
  done boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);

create index account_actions_account_id_idx on account_actions (account_id);

-- ---------------------------------------------------------------------------
-- account_products : CA / quantités par marque (Growth by Brand, Products Purchased)
-- ---------------------------------------------------------------------------
create table account_products (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  brand text not null,
  sales_value_ly numeric,
  sales_value_cy numeric,
  qty_ordered_ly numeric,
  qty_ordered_cy numeric,
  growth_rate_pct numeric,
  period text,                                   -- ex. 'YTD 2026'
  updated_at timestamptz not null default now(),
  unique (account_id, brand, period)
);

create index account_products_account_id_idx on account_products (account_id);

-- ---------------------------------------------------------------------------
-- price_list_owners : référence PARTENAIRES (liste de prix ↔ commercial)
-- ---------------------------------------------------------------------------
create table price_list_owners (
  id uuid primary key default gen_random_uuid(),
  price_list text not null,
  external_ref text not null,
  owner text,
  unique (price_list, external_ref)
);

-- ---------------------------------------------------------------------------
-- territory_objectives : objectifs par territoire (module carte "gamifié")
-- ---------------------------------------------------------------------------
create table territory_objectives (
  id uuid primary key default gen_random_uuid(),
  department_code text not null unique,          -- '01'..'74'
  department_name text not null,
  objectif_ca numeric not null default 0,
  objectif_boites numeric not null default 0,
  quarter text not null default 'Q3 2026',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger accounts_set_updated_at before update on accounts
  for each row execute function set_updated_at();

create trigger territory_objectives_set_updated_at before update on territory_objectives
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — activé, accès en lecture/écriture pour les utilisateurs authentifiés
-- (à affiner avec une table de rôles si plusieurs commerciaux partagent l'app)
-- ---------------------------------------------------------------------------
alter table accounts enable row level security;
alter table imports enable row level security;
alter table account_actions enable row level security;
alter table account_products enable row level security;
alter table price_list_owners enable row level security;
alter table territory_objectives enable row level security;

create policy "authenticated read accounts" on accounts for select to authenticated using (true);
create policy "authenticated write accounts" on accounts for all to authenticated using (true) with check (true);

create policy "authenticated read imports" on imports for select to authenticated using (true);
create policy "authenticated write imports" on imports for all to authenticated using (true) with check (true);

create policy "authenticated read account_actions" on account_actions for select to authenticated using (true);
create policy "authenticated write account_actions" on account_actions for all to authenticated using (true) with check (true);

create policy "authenticated read account_products" on account_products for select to authenticated using (true);
create policy "authenticated write account_products" on account_products for all to authenticated using (true) with check (true);

create policy "authenticated read price_list_owners" on price_list_owners for select to authenticated using (true);
create policy "authenticated write price_list_owners" on price_list_owners for all to authenticated using (true) with check (true);

create policy "authenticated read territory_objectives" on territory_objectives for select to authenticated using (true);
create policy "authenticated write territory_objectives" on territory_objectives for all to authenticated using (true) with check (true);
