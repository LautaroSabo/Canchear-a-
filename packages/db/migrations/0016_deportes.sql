-- Otros deportes además del fútbol. jugadores_por_lado solo distingue en fútbol (5, 7…);
-- en pádel y tenis se guarda 2.
ALTER TABLE canchas ADD COLUMN deporte text NOT NULL DEFAULT 'FUTBOL'
  CHECK (deporte IN ('FUTBOL', 'PADEL', 'TENIS'));
ALTER TABLE canchas DROP CONSTRAINT canchas_jugadores_por_lado_check;
ALTER TABLE canchas ADD CONSTRAINT canchas_jugadores_por_lado_check
  CHECK (jugadores_por_lado BETWEEN 1 AND 11);

-- La lista de espera "cualquier cancha de pádel" (o de fútbol 5).
ALTER TABLE lista_espera ADD COLUMN deporte text
  CHECK (deporte IS NULL OR deporte IN ('FUTBOL', 'PADEL', 'TENIS'));

-- Torneos de pádel o tenis: se cargan sets y no hay empates.
ALTER TABLE torneos ADD COLUMN deporte text NOT NULL DEFAULT 'FUTBOL'
  CHECK (deporte IN ('FUTBOL', 'PADEL', 'TENIS'));
ALTER TABLE torneos DROP CONSTRAINT torneos_jugadores_por_lado_check;
ALTER TABLE torneos ADD CONSTRAINT torneos_jugadores_por_lado_check
  CHECK (jugadores_por_lado BETWEEN 1 AND 11);

ALTER TYPE tipo_superficie ADD VALUE IF NOT EXISTS 'POLVO_LADRILLO';
