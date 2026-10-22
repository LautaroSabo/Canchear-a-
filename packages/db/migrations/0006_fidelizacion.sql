-- =============================================================================
-- 0006 — Fidelización: canjes aplicados a turnos y movimientos con autor
-- =============================================================================

-- Un canje de descuento (monto, porcentaje o turno gratis) se aplica a un turno y
-- baja su saldo en `monto_aplicado`. Los de producto se entregan en el mostrador.
ALTER TABLE canjes ADD COLUMN monto_aplicado bigint NOT NULL DEFAULT 0 CHECK (monto_aplicado >= 0);
ALTER TABLE canjes ADD COLUMN usado_en timestamptz;
ALTER TABLE canjes ADD COLUMN creado_por uuid REFERENCES usuarios(id);
ALTER TABLE canjes ADD COLUMN anulado_en timestamptz;
ALTER TABLE canjes ADD COLUMN motivo_anulacion text;
ALTER TABLE canjes ADD CONSTRAINT canjes_aplicado_ck CHECK (monto_aplicado = 0 OR turno_id IS NOT NULL);
CREATE INDEX canjes_cliente ON canjes (cliente_id, creado_en DESC);
CREATE INDEX canjes_turno ON canjes (turno_id) WHERE turno_id IS NOT NULL AND estado = 'USADO';

-- Ajustes manuales: quién y por qué.
ALTER TABLE movimientos_puntos ADD COLUMN usuario_id uuid REFERENCES usuarios(id);
ALTER TABLE movimientos_puntos ADD COLUMN motivo text;

ALTER TABLE promociones_puntos
  ADD CONSTRAINT promociones_franja_ck CHECK ((hora_desde IS NULL) = (hora_hasta IS NULL));

-- Búsqueda de clientes por nombre desde el panel.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX clientes_nombre_trgm ON clientes USING gin (nombre gin_trgm_ops);
