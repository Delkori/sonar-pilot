-- Rapprochement flou des noms entre le référentiel Salesforce et les
-- fichiers de factures (souvent formulés différemment, ex. "DR BEILLE
-- Laurence" vs "CABINET DR BEILLE Laurence").

-- Correspondances confirmées (auto à haute confiance, ou validées par
-- l'utilisateur) — mémorisées pour ne plus jamais redemander.
create table name_aliases (
  id uuid primary key default gen_random_uuid(),
  raw_name text not null unique,
  account_id uuid not null references accounts(id) on delete cascade,
  confidence numeric,
  created_at timestamptz not null default now()
);

-- Correspondances incertaines, en attente de validation manuelle.
create table name_match_candidates (
  id uuid primary key default gen_random_uuid(),
  raw_name text not null unique,
  candidate_account_id uuid references accounts(id) on delete set null,
  candidate_name text,
  confidence numeric,
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger name_match_candidates_set_updated_at before update on name_match_candidates
  for each row execute function set_updated_at();

alter table name_aliases enable row level security;
alter table name_match_candidates enable row level security;

create policy "authenticated read name_aliases" on name_aliases for select to authenticated using (true);
create policy "authenticated write name_aliases" on name_aliases for all to authenticated using (true) with check (true);

create policy "authenticated read name_match_candidates" on name_match_candidates for select to authenticated using (true);
create policy "authenticated write name_match_candidates" on name_match_candidates for all to authenticated using (true) with check (true);
