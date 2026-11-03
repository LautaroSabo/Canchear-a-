-- =============================================================================
-- 0008 — El jugador cancela su reserva desde el comprobante
-- =============================================================================

-- Hasta cuántas horas antes del turno el jugador puede cancelar online (con devolución
-- de la seña). Pasado ese plazo tiene que pedírselo al club. 0 = no se cancela online.
ALTER TABLE clubs ADD COLUMN horas_cancelacion integer NOT NULL DEFAULT 24
  CHECK (horas_cancelacion BETWEEN 0 AND 168);
