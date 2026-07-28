-- Rendez-vous validé : une fois confirmé (par le médecin/le compte), le
-- créneau est marqué et protégé d'une régénération automatique du planning.
alter table planning_events
  add column confirmed boolean not null default false;
