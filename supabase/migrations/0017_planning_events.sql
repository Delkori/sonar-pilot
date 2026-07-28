-- Planning hebdomadaire : visites, appels et blocs administratifs, avec
-- horaires précis (drag & drop + redimensionnement façon calendrier iPhone).
create table planning_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  type text not null check (type in ('visite', 'visite_prospect', 'appel', 'admin')),
  title text not null,
  note text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  source text not null default 'manuel' check (source in ('auto', 'manuel')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index planning_events_start_at_idx on planning_events (start_at);
create index planning_events_account_id_idx on planning_events (account_id);

alter table planning_events enable row level security;

create policy "planning_events_select" on planning_events
  for select to authenticated using (true);
create policy "planning_events_all" on planning_events
  for all to authenticated using (true) with check (true);
