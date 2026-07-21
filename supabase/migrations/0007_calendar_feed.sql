-- Jeton secret unique pour le flux ICS public (abonnement calendrier
-- iPhone). Pas d'authentification interactive possible côté Apple
-- Calendar, donc l'accès est protégé par ce jeton dans l'URL plutôt que
-- par une session.
create table calendar_feed_tokens (
  token text primary key default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now()
);

alter table calendar_feed_tokens enable row level security;
create policy "authenticated read calendar_feed_tokens" on calendar_feed_tokens for select to authenticated using (true);
create policy "authenticated write calendar_feed_tokens" on calendar_feed_tokens for all to authenticated using (true) with check (true);

insert into calendar_feed_tokens default values;
