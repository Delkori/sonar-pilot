-- Médecins (HCP) rattachés à une structure (HCO = accounts). Le Rapport
-- Salesforce contient maintenant les deux niveaux dans le même export,
-- distingués par la présence de "Parent principal". Le RPPS servira de
-- clé de rapprochement future avec les tables de sponsoring Nexora.
create table hcps (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete set null,
  external_ref text not null unique,
  name text not null,
  rpps text,
  segment text check (segment in ('A','B','C','D','E')),
  potentiel_boites numeric,
  address text,
  postal_code text,
  city text,
  email text,
  telephone text,
  nom_concurrent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hcps_account_id_idx on hcps (account_id);
create index hcps_rpps_idx on hcps (rpps);

create trigger hcps_set_updated_at before update on hcps
  for each row execute function set_updated_at();

alter table hcps enable row level security;
create policy "authenticated read hcps" on hcps for select to authenticated using (true);
create policy "authenticated write hcps" on hcps for all to authenticated using (true) with check (true);
