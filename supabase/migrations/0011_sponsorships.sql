-- Liens de sponsoring importés depuis Nexora : quel laboratoire sponsorise
-- quel médecin (HCP) et pour quel montant. Rattaché aux médecins via le
-- RPPS (déjà stocké sur la table hcps), clé de jointure commune aux deux
-- applications.
create table hcp_sponsorships (
  id uuid primary key default gen_random_uuid(),
  rpps text,
  hcp_name text,
  laboratoire text not null,
  montant numeric,
  annee integer,
  type text,
  source text not null default 'nexora',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hcp_sponsorships_rpps_idx on hcp_sponsorships (rpps);
create index hcp_sponsorships_labo_idx on hcp_sponsorships (laboratoire);

create trigger hcp_sponsorships_set_updated_at before update on hcp_sponsorships
  for each row execute function set_updated_at();

alter table hcp_sponsorships enable row level security;
create policy "authenticated read hcp_sponsorships" on hcp_sponsorships for select to authenticated using (true);
create policy "authenticated write hcp_sponsorships" on hcp_sponsorships for all to authenticated using (true) with check (true);
