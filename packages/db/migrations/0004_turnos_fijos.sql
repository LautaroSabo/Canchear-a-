-- =============================================================================
-- 0004 — Turnos fijos: idempotencia de la materialización y fechas omitidas
-- =============================================================================

-- Cada fecha de un turno fijo se materializa una sola vez, aunque el worker y el
-- panel corran a la vez o se reintente: si después se cancela esa fecha (no juegan
-- esa semana), no se vuelve a generar.
CREATE UNIQUE INDEX turnos_fijo_inicio_uq ON turnos (turno_fijo_id, inicio) WHERE turno_fijo_id IS NOT NULL;

-- Nota interna del club sobre el turno fijo ("pagan por mes", "equipo de la empresa X").
ALTER TABLE turnos_fijos ADD COLUMN nota text CHECK (char_length(nota) <= 500);
ALTER TABLE turnos_fijos ADD COLUMN creado_por uuid REFERENCES usuarios(id);
ALTER TABLE turnos_fijos ADD COLUMN creado_en timestamptz NOT NULL DEFAULT now();
CREATE INDEX turnos_fijos_club ON turnos_fijos (club_id) WHERE activo;

-- Fechas que no se pudieron generar: la cancha ya estaba tomada en ese horario, el
-- club cerraba (feriado) o no había precio. El club las ve en el panel para avisarle
-- al cliente o resolver el choque y reintentar.
CREATE TABLE turnos_fijos_omitidos (
  turno_fijo_id     uuid NOT NULL REFERENCES turnos_fijos(id) ON DELETE CASCADE,
  fecha             date NOT NULL,
  club_id           uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  motivo            text NOT NULL CHECK (motivo IN ('OCUPADO', 'CERRADO', 'SIN_TARIFA')),
  turno_conflicto_id uuid REFERENCES turnos(id) ON DELETE SET NULL,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  revisado_en       timestamptz,
  PRIMARY KEY (turno_fijo_id, fecha)
);
CREATE INDEX turnos_fijos_omitidos_pendientes ON turnos_fijos_omitidos (club_id, fecha) WHERE revisado_en IS NULL;
