-- Commentaire utilisateur sur une ligne de prévision, distinct de `note`
-- (texte généré par le modèle) : jamais réécrit par la génération auto,
-- donc jamais perdu au clic sur "Générer".
alter table account_forecasts
  add column commentaire text;
