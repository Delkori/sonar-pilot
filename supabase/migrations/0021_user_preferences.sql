-- Préférences propres à chaque utilisateur — pour commencer, la mise en
-- page du dashboard (widgets affichés, ordre, largeur). Une ligne par
-- utilisateur, lisible et modifiable par lui seul : la préférence suit la
-- personne d'un appareil à l'autre, au lieu de rester dans un navigateur.
create table if not exists user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  dashboard_layout jsonb,
  updated_at timestamptz not null default now()
);

alter table user_preferences enable row level security;

create policy "user_preferences_select_own" on user_preferences
  for select to authenticated using (user_id = auth.uid());
create policy "user_preferences_insert_own" on user_preferences
  for insert to authenticated with check (user_id = auth.uid());
create policy "user_preferences_update_own" on user_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
