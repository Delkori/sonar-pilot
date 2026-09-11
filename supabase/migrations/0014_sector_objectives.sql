-- Objectifs mensuels du secteur (saisis dans Paramètres › Objectifs) — sert
-- de référence au graphique « Objectif vs Réalisé » du dashboard et au
-- Pilotage.
--
-- Cette migration reconstitue une table qui existait en production mais dont
-- le fichier n'avait jamais été versionné : la numérotation passait de 0013
-- à 0015. Conséquence, un `supabase db push` sur une base neuve (projet de
-- développement, environnement de test) produisait un schéma sans
-- `sector_objectives` — et les écrans Paramètres, Dashboard et Pilotage
-- échouaient à l'exécution sur une table inexistante, alors que la prod
-- fonctionnait. La forme ci-dessous est déduite de l'usage réel dans le
-- code (types/database.ts et SectorObjectivesEditor).
--
-- `if not exists` partout : la table est déjà en place en production, cette
-- migration ne doit rien y changer.
create table if not exists sector_objectives (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  objectif_ca numeric not null default 0,
  objectif_boites int not null default 0,
  updated_at timestamptz not null default now(),
  -- L'éditeur enregistre avec `upsert(..., { onConflict: "year,month" })` :
  -- sans cette contrainte d'unicité, chaque enregistrement créerait une
  -- ligne de plus au lieu de mettre à jour l'objectif du mois.
  unique (year, month)
);

create index if not exists sector_objectives_year_month_idx on sector_objectives (year, month);

alter table sector_objectives enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'sector_objectives' and policyname = 'sector_objectives_select') then
    create policy "sector_objectives_select" on sector_objectives
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'sector_objectives' and policyname = 'sector_objectives_all') then
    create policy "sector_objectives_all" on sector_objectives
      for all to authenticated using (true) with check (true);
  end if;
end $$;
