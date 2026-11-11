-- Precio del abono según la cantidad de canchas activas del club, y precio especial por
-- club (fundador, acuerdo) con vencimiento. Reemplaza al precio único ABONO_MENSUAL.
CREATE TABLE planes_abono (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         text NOT NULL,
  -- El plan vale desde esta cantidad de canchas activas hasta la del plan siguiente - 1.
  desde_canchas  integer NOT NULL UNIQUE CHECK (desde_canchas >= 1),
  precio         bigint NOT NULL CHECK (precio >= 0), -- centavos por mes
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
INSERT INTO planes_abono (nombre, desde_canchas, precio) VALUES
  ('Chico', 1, 3990000),
  ('Mediano', 4, 5990000),
  ('Grande', 7, 7990000);

ALTER TABLE clubs
  -- Precio especial: un porcentaje de descuento sobre su plan, o un precio fijo.
  ADD COLUMN abono_descuento_pct smallint CHECK (abono_descuento_pct BETWEEN 1 AND 100),
  ADD COLUMN abono_precio_fijo bigint CHECK (abono_precio_fijo >= 0),
  -- Último día con el precio especial (null: sin vencimiento).
  ADD COLUMN abono_especial_hasta date,
  ADD COLUMN abono_especial_motivo text,
  -- Monto que tiene hoy la suscripción de Mercado Pago (para saber si hay que actualizarlo).
  ADD COLUMN mp_suscripcion_monto bigint,
  ADD CONSTRAINT abono_especial_uno_solo CHECK (abono_descuento_pct IS NULL OR abono_precio_fijo IS NULL);
