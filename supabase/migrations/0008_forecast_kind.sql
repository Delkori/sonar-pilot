-- Distingue les objectifs assignés (kind='objectif') des prévisions
-- personnelles (kind='prevision') dans la même table, pour réutiliser le
-- même mécanisme mois par mois sans dupliquer l'infrastructure.
alter table account_forecasts add column kind text not null default 'prevision' check (kind in ('objectif','prevision'));
alter table account_forecasts drop constraint account_forecasts_account_id_year_month_key;
alter table account_forecasts add constraint account_forecasts_account_id_year_month_kind_key unique (account_id, year, month, kind);
