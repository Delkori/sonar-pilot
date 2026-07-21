-- 1. Nouveau type d'action "offre" (proposition commerciale / devis) en
--    plus de commentaire / action / relance.
alter table account_actions drop constraint account_actions_type_check;
alter table account_actions add constraint account_actions_type_check
  check (type in ('commentaire','action','relance','offre'));

-- 2. Nouveau "kind" de prévision : 'realise' — le CA/boîtes réellement
--    réalisé, saisi à la main ou recopié depuis l'historique de commandes,
--    pour les mois sans import de factures. Objectif et prévision restent
--    inchangés. La contrainte d'unicité (account_id, year, month, kind)
--    couvre déjà ce nouveau kind sans modification.
alter table account_forecasts drop constraint account_forecasts_kind_check;
alter table account_forecasts add constraint account_forecasts_kind_check
  check (kind in ('objectif','prevision','realise'));
