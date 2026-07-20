-- Prévisionnel commercial éditable, mois par mois, par compte.
-- Distinct des données réelles (account_monthly_sales) : ce sont VOS
-- projections, que vous ajoutez/modifiez/supprimez librement pour
-- construire votre plan d'action, comme dans le PAS.

create table account_forecasts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  boites_prevues numeric,
  ca_prevu numeric,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, year, month)
);

create index account_forecasts_account_id_idx on account_forecasts (account_id);
create index account_forecasts_year_month_idx on account_forecasts (year, month);

create trigger account_forecasts_set_updated_at before update on account_forecasts
  for each row execute function set_updated_at();

alter table account_forecasts enable row level security;

create policy "authenticated read account_forecasts" on account_forecasts for select to authenticated using (true);
create policy "authenticated write account_forecasts" on account_forecasts for all to authenticated using (true) with check (true);
