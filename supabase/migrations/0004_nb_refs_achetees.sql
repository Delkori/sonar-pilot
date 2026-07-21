-- Nombre de références fillers (sur 10) achetées en 2025, compté depuis
-- l'onglet DATA PRODUITS 2025 du PAS. Alimente le critère "références
-- manquantes" du score de ciblage.
alter table accounts add column nb_refs_achetees_2025 integer;
