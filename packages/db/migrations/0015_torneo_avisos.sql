-- Avisos por mail a los delegados de los equipos (fixture, cambios de horario y el partido
-- del día siguiente). El email es opcional: sin él no se le avisa.
ALTER TABLE torneo_equipos ADD COLUMN delegado_email text;
-- Cuándo se procesó el recordatorio del partido (null: todavía no).
ALTER TABLE torneo_partidos ADD COLUMN recordatorio_en timestamptz;
