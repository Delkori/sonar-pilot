-- Comment une prévision sera traitée quand aucun rendez-vous n'est planifié
-- ce mois-là : une visite à caler, un appel, ou un simple mail. Sert à
-- signaler dans Planning › Mois les prévisions « en l'air » (ni rendez-vous
-- ni mode de contact décidé) sans obliger à créer un créneau pour un
-- échange qui n'en demande pas.
alter table account_forecasts
  add column if not exists contact_mode text
  check (contact_mode in ('visite', 'appel', 'mail'));
