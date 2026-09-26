-- Durcissement découvert par l'audit sécurité Supabase juste après la
-- migration 0022 (multi-secteur) :
--
-- 1. Quatre vues (`v_accounts_active`, `v_hcps_active`, `v_hcp_market_intel`,
--    `v_hcp_import_summary`) existaient déjà en base — restes d'un chantier
--    (suppression douce + import HCP Salesforce + snapshot marché Nexora)
--    jamais versionné dans ce dépôt et non utilisé par le code applicatif
--    actuel (aucune référence dans app/lib/components). Elles étaient
--    `SECURITY DEFINER` : Postgres les exécute avec les droits de leur
--    créateur, donc **en contournant RLS** — n'importe quel utilisateur
--    authentifié, y compris via l'API REST auto-générée de Supabase
--    (`/rest/v1/v_accounts_active`) en dehors même de l'app, pouvait lire
--    les comptes/médecins de TOUS les secteurs, pas seulement le sien. Avec
--    un seul commercial cette fuite n'avait pas de victime ; avec deux
--    secteurs cloisonnés par RLS (migration 0022), c'était un contournement
--    total de l'isolation qu'on vient d'introduire. Passées en
--    `SECURITY INVOKER` (Postgres 15+), ces vues respectent désormais RLS
--    de l'utilisateur qui les interroge — donc `sector_id` sur les tables
--    sous-jacentes.
--
-- 2. `current_sector_id()` (créée par la migration 0022) n'avait pas de
--    `search_path` figé : un rôle capable de modifier son propre
--    `search_path` pourrait faire résoudre `sector_id`/`profiles` vers un
--    objet de son choix plutôt que ceux de `public`. Fixé ici, avec la même
--    correction apportée à `set_updated_at` (migration 0001), repérée par
--    le même audit.

alter view v_accounts_active set (security_invoker = true);
alter view v_hcps_active set (security_invoker = true);
alter view v_hcp_market_intel set (security_invoker = true);
alter view v_hcp_import_summary set (security_invoker = true);

create or replace function current_sector_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select sector_id from profiles where user_id = auth.uid()
$$;

create or replace function set_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
