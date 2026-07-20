-- Ventes mensuelles par compte (source: "Products Purchased By Customers" export,
-- seul fichier fournissant une granularité mensuelle réelle par client).
-- Alimente le sélecteur année/mois du Dashboard.

create table account_monthly_sales (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  ca numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (account_id, year, month)
);

create index account_monthly_sales_account_id_idx on account_monthly_sales (account_id);
create index account_monthly_sales_year_month_idx on account_monthly_sales (year, month);

create trigger account_monthly_sales_set_updated_at before update on account_monthly_sales
  for each row execute function set_updated_at();

alter table account_monthly_sales enable row level security;

create policy "authenticated read account_monthly_sales" on account_monthly_sales for select to authenticated using (true);
create policy "authenticated write account_monthly_sales" on account_monthly_sales for all to authenticated using (true) with check (true);
