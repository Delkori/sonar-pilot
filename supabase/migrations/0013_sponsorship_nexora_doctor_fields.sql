-- On stocke aussi les médecins connus de Nexora même sans laboratoire de
-- sponsoring (pour repérer ceux absents du Salesforce), donc laboratoire
-- devient nullable. Ajout du contexte structure/département/spécialité.
alter table hcp_sponsorships alter column laboratoire drop not null;
alter table hcp_sponsorships add column if not exists structure_nom text;
alter table hcp_sponsorships add column if not exists departement text;
alter table hcp_sponsorships add column if not exists specialite text;
