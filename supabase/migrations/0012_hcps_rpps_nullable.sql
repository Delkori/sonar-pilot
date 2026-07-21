-- Le RPPS n'est pas toujours renseigné dans l'export Salesforce : un médecin
-- sans RPPS doit quand même être enregistré (son external_ref retombe alors
-- sur son nom normalisé). La contrainte NOT NULL présente en production
-- faisait échouer tout le lot d'import HCP dès qu'une ligne n'avait pas de
-- RPPS — on la retire.
alter table hcps alter column rpps drop not null;
