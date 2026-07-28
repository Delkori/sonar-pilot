-- Traçabilité de l'origine d'une ligne de prévisionnel : 'auto' = créée ou
-- mise à jour par le générateur portefeuille (rafraîchissable sans risque),
-- 'manuel' = saisie ou modifiée par l'utilisateur (jamais écrasée par une
-- régénération). Sert à ce que "Générer le prévisionnel du portefeuille"
-- puisse actualiser ses propres valeurs sans jamais toucher à ce que
-- l'utilisateur a rempli lui-même.
alter table account_forecasts
  add column source text not null default 'manuel' check (source in ('auto', 'manuel'));

-- Les lignes déjà en base ont été créées manuellement ou par l'ancien
-- générateur (jamais reconduites automatiquement) : on les marque 'manuel'
-- par prudence, pour que la nouvelle régénération ne les écrase pas
-- silencieusement au premier essai.
update account_forecasts set source = 'manuel';
