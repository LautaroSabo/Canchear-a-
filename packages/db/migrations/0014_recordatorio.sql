-- Recordatorio por mail antes del partido. horas_recordatorio = 0: el club no lo manda.
ALTER TABLE clubs ADD COLUMN horas_recordatorio integer NOT NULL DEFAULT 3
  CHECK (horas_recordatorio BETWEEN 0 AND 48);
-- Cuándo se procesó el recordatorio de cada turno (se haya mandado o no): nunca dos veces.
ALTER TABLE turnos ADD COLUMN recordatorio_en timestamptz;
CREATE INDEX turnos_recordatorio_pendiente ON turnos (inicio)
  WHERE estado = 'CONFIRMADO' AND recordatorio_en IS NULL;
