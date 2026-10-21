-- =============================================================================
-- 0005 — Cantina: ventas (mostrador o a la cuenta de un turno) y movimientos de stock
-- =============================================================================

ALTER TABLE inventario_cantina
  ADD CONSTRAINT inventario_categoria_ck CHECK (categoria IN ('BEBIDA', 'COMIDA', 'ALQUILER', 'OTRO'));

-- Una venta es un ticket: o se cobra en el momento (medio) o se carga a la cuenta de un
-- turno (turno_id) y se cobra junto con el saldo. Nunca las dos cosas.
CREATE TABLE ventas_cantina (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  turno_id         uuid REFERENCES turnos(id) ON DELETE CASCADE,
  medio            proveedor_pago,
  total            bigint NOT NULL CHECK (total >= 0),
  idempotency_key  uuid,
  creado_por       uuid REFERENCES usuarios(id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  anulada_en       timestamptz,
  anulada_por      uuid REFERENCES usuarios(id),
  motivo_anulacion text,
  CHECK ((turno_id IS NULL) <> (medio IS NULL)),
  CHECK ((anulada_en IS NULL) = (motivo_anulacion IS NULL))
);
CREATE UNIQUE INDEX ventas_idempotency_uq ON ventas_cantina (club_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ventas_club_fecha ON ventas_cantina (club_id, creado_en);
CREATE INDEX ventas_turno ON ventas_cantina (turno_id) WHERE turno_id IS NOT NULL AND anulada_en IS NULL;

-- Los consumos pasan a ser los renglones de una venta (nunca se usaron sin venta).
DROP INDEX consumos_turno;
ALTER TABLE consumos DROP COLUMN turno_id;
ALTER TABLE consumos ADD COLUMN venta_id uuid NOT NULL REFERENCES ventas_cantina(id) ON DELETE CASCADE;
CREATE INDEX consumos_venta ON consumos (venta_id);

-- Libro de stock: cada cambio queda con quién, cuándo y por qué. `inventario_cantina.stock`
-- es el saldo; el libro permite auditarlo (faltantes, quién ajustó).
CREATE TABLE movimientos_stock (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  club_id          uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  producto_id      uuid NOT NULL REFERENCES inventario_cantina(id) ON DELETE CASCADE,
  tipo             text NOT NULL CHECK (tipo IN ('VENTA', 'ANULACION', 'REPOSICION', 'AJUSTE')),
  cantidad         integer NOT NULL CHECK (cantidad <> 0),   -- con signo
  stock_resultante integer,                                  -- NULL si no controla stock
  venta_id         uuid REFERENCES ventas_cantina(id) ON DELETE SET NULL,
  usuario_id       uuid REFERENCES usuarios(id),
  motivo           text,
  creado_en        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX movimientos_producto ON movimientos_stock (producto_id, id DESC);
