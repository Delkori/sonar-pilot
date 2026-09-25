-- Secteurs multi-commerciaux.
--
-- Jusqu'ici l'app supposait un seul commercial : RLS n'imposait que
-- « authentifié ou pas », ce qui protège la clé anon (publique, embarquée
-- dans le navigateur) mais mélangerait les comptes/ventes/planning de deux
-- commerciaux dès qu'un second utilisateur se connecte. Cette migration
-- introduit `sectors` (un territoire = AURA, Languedoc...) et `profiles`
-- (quel commercial appartient à quel secteur), puis rattache CHAQUE table
-- métier à un secteur et réécrit RLS pour qu'un commercial ne voie et
-- n'écrive jamais que les lignes de son propre secteur.

create table sectors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  -- Codes département (INSEE, 2 caractères) couverts par le secteur — sert
  -- de filtre pour les requêtes Nexora (prospection) et, plus tard, pour
  -- les objectifs par département (territory_objectives).
  department_codes text[] not null default '{}',
  -- Région administrative à passer aux fonctions Nexora (sonar_competitor_amounts) :
  -- null quand le secteur ne correspond à aucune région officielle unique
  -- (ex. Languedoc, qui chevauche Occitanie et PACA) — dans ce cas seul le
  -- filtre par département s'applique.
  nexora_region text,
  -- Fichier GeoJSON (public/geo/<fichier>) des contours du secteur pour
  -- Comptes › Carte.
  geojson_path text,
  created_at timestamptz not null default now()
);

alter table sectors enable row level security;
create policy "sectors_select" on sectors for select to authenticated using (true);

insert into sectors (slug, name, department_codes, nexora_region, geojson_path) values
  (
    'aura',
    'Auvergne-Rhône-Alpes',
    array['01','03','07','15','26','38','42','43','58','63','69','71','73','74'],
    'Auvergne-Rhône-Alpes',
    'aura-departements.json'
  ),
  (
    -- Département fourni provisoirement (Aude/Narbonne, Bouches-du-Rhône/
    -- Marseille, Hérault/Montpellier, Vaucluse/Orange) — le découpage
    -- définitif sera ajusté plus tard par un simple
    -- `update sectors set department_codes = ... where slug = 'languedoc'`,
    -- sans nouvelle migration.
    'languedoc',
    'Languedoc',
    array['11','13','34','84'],
    null,
    'languedoc-departements.json'
  );

-- ---------------------------------------------------------------------------
-- profiles : un commercial (auth.users) = un secteur. Volontairement AUCUNE
-- policy d'insertion/mise à jour pour le rôle `authenticated` : rattacher un
-- utilisateur à un secteur ne se fait que depuis l'éditeur SQL Supabase
-- (rôle postgres, hors RLS) — un commercial ne peut jamais se rattacher
-- lui-même à un autre secteur que le sien pour lire les données d'un
-- collègue.
-- ---------------------------------------------------------------------------
create table profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sector_id uuid not null references sectors (id),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
create policy "profiles_select" on profiles for select to authenticated using (user_id = auth.uid());

-- Bascule tout utilisateur déjà existant (avant cette migration, un seul
-- commercial sans notion de secteur) sur le secteur historique AURA — sans
-- ça, ses lectures/écritures s'arrêteraient net dès l'activation de RLS par
-- secteur plus bas.
insert into profiles (user_id, sector_id)
select u.id, (select id from sectors where slug = 'aura')
from auth.users u
where not exists (select 1 from profiles p where p.user_id = u.id);

create or replace function current_sector_id()
returns uuid
language sql
stable
as $$
  select sector_id from profiles where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- sector_id sur chaque table métier : ajouté, rempli sur AURA (seul secteur
-- existant avant cette migration), rendu obligatoire, puis pourvu d'un
-- défaut (`current_sector_id()`) — le code applicatif, qui n'a jamais eu à
-- préciser de secteur, continue d'insérer sans rien changer : Postgres
-- remplit la colonne à l'insertion à partir du commercial connecté.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  aura_id uuid := (select id from sectors where slug = 'aura');
begin
  foreach t in array array[
    'accounts', 'imports', 'account_actions', 'account_products',
    'price_list_owners', 'territory_objectives', 'account_monthly_sales',
    'account_forecasts', 'name_aliases', 'name_match_candidates', 'hcps',
    'hcp_sponsorships', 'sector_objectives', 'planning_events',
    'account_product_purchases', 'calendar_feed_tokens'
  ]
  loop
    execute format('alter table %I add column if not exists sector_id uuid references sectors(id)', t);
    execute format('update %I set sector_id = $1 where sector_id is null', t) using aura_id;
    execute format('alter table %I alter column sector_id set not null', t);
    execute format('alter table %I alter column sector_id set default current_sector_id()', t);
    execute format('create index if not exists %I on %I (sector_id)', t || '_sector_id_idx', t);
  end loop;
end $$;

-- territory_objectives : le code département n'est plus unique tout court,
-- seulement par secteur (deux secteurs peuvent chacun avoir un département
-- du même numéro un jour).
alter table territory_objectives drop constraint territory_objectives_department_code_key;
alter table territory_objectives add constraint territory_objectives_sector_dept_key unique (sector_id, department_code);

-- Un flux calendrier par secteur : celui d'AURA existe déjà (rempli par la
-- boucle ci-dessus), Languedoc a besoin du sien pour que l'abonnement iPhone
-- fonctionne dès la première connexion de Mélanie.
insert into calendar_feed_tokens (sector_id) values ((select id from sectors where slug = 'languedoc'));

-- ---------------------------------------------------------------------------
-- RLS : remplace les policies « tout utilisateur authentifié voit/écrit
-- tout » par un filtre sur le secteur de l'utilisateur connecté.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array[
    'accounts', 'imports', 'account_actions', 'account_products',
    'price_list_owners', 'territory_objectives', 'account_monthly_sales',
    'account_forecasts', 'name_aliases', 'name_match_candidates', 'hcps',
    'hcp_sponsorships', 'sector_objectives', 'planning_events',
    'account_product_purchases', 'calendar_feed_tokens'
  ]
  loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on %I', pol.policyname, t);
    end loop;
    execute format(
      'create policy %I on %I for select to authenticated using (sector_id = current_sector_id())',
      t || '_select', t
    );
    execute format(
      'create policy %I on %I for all to authenticated using (sector_id = current_sector_id()) with check (sector_id = current_sector_id())',
      t || '_all', t
    );
  end loop;
end $$;
