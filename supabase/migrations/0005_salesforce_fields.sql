-- Champs alimentés par le nouveau pipeline sans PAS (Rapport Salesforce +
-- ACCOUNT DETAIL + INVOICE NUMBER ET PRODUCT).
alter table accounts add column email text;
alter table accounts add column telephone text;
alter table accounts add column nom_concurrent text;
alter table accounts add column objectif_filler numeric;
alter table accounts add column objectif_cosmetique numeric;
comment on column accounts.objectif_boites is 'Objectif total (boîtes), saisi manuellement dans l''app depuis que le PAS n''est plus disponible.';
