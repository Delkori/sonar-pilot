-- Historique ligne à ligne des achats compte × marque × date, nécessaire au
-- module SonarScore (vélocités de réapprovisionnement par produit, RFM-S).
-- Jusqu'ici, l'import de factures (INVOICE NUMBER ET PRODUCT) calculait des
-- agrégats cy/ly dans account_products puis jetait la date de chaque ligne —
-- aucune donnée transactionnelle datée n'était persistée. Cette table est
-- additive : elle ne remplace rien, account_products et le reste de l'app
-- ne changent pas.
create table account_product_purchases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  brand text not null,
  purchase_date date not null,
  qty numeric not null default 0,
  value_eur numeric not null default 0,
  invoice_number text,
  created_at timestamptz not null default now(),
  unique (account_id, brand, purchase_date, invoice_number)
);

create index account_product_purchases_account_brand_idx
  on account_product_purchases (account_id, brand, purchase_date);

alter table account_product_purchases enable row level security;

create policy "authenticated read account_product_purchases" on account_product_purchases
  for select to authenticated using (true);
create policy "authenticated write account_product_purchases" on account_product_purchases
  for all to authenticated using (true) with check (true);
