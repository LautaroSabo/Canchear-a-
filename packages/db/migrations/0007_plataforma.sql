-- =============================================================================
-- 0007 — Plataforma: registro de clubes con aprobación y abono mensual
-- =============================================================================

-- PENDIENTE: se registró solo y espera aprobación (la página se ve, pero no toma
-- reservas). ACTIVO: toma reservas. SUSPENDIDO: pausado por la plataforma (abono
-- impago u otro motivo). Los clubes que ya existían quedan activos.
ALTER TABLE clubs ADD COLUMN estado text NOT NULL DEFAULT 'ACTIVO'
  CHECK (estado IN ('PENDIENTE', 'ACTIVO', 'SUSPENDIDO'));
ALTER TABLE clubs ADD COLUMN aprobado_en timestamptz;
ALTER TABLE clubs ADD COLUMN motivo_suspension text;
-- Último día cubierto por el abono (incluye la prueba gratis). NULL: nunca pagó.
ALTER TABLE clubs ADD COLUMN abono_hasta date;
CREATE INDEX clubs_estado ON clubs (estado, creado_en DESC);

-- Quien administra la plataforma (aprueba clubes, registra abonos). Se marca por CLI.
ALTER TABLE usuarios ADD COLUMN es_superadmin boolean NOT NULL DEFAULT false;

-- Pagos del abono que recibe la plataforma de cada club (los carga el superadmin).
CREATE TABLE pagos_abono (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES clubs(id),
  monto          bigint NOT NULL CHECK (monto >= 0),
  meses          integer NOT NULL CHECK (meses BETWEEN 1 AND 24),
  desde          date NOT NULL,
  hasta          date NOT NULL CHECK (hasta >= desde),
  medio          text NOT NULL,
  nota           text,
  registrado_por uuid REFERENCES usuarios(id),
  creado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pagos_abono_club ON pagos_abono (club_id, creado_en DESC);
