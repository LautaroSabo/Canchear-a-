-- =============================================================================
-- 0002 — Cobro de seña (Mercado Pago / transferencia), reembolsos y lista de espera
-- =============================================================================

-- Cuánto se extiende el hold cuando el cliente sube un comprobante de transferencia,
-- para que el club alcance a revisarlo (0 = no se extiende). Nunca pasa del inicio.
ALTER TABLE clubs
  ADD COLUMN minutos_revision_transferencia integer NOT NULL DEFAULT 60
  CHECK (minutos_revision_transferencia BETWEEN 0 AND 1440);

-- URL del checkout de Mercado Pago, para reusar la preferencia si el cliente vuelve.
ALTER TABLE pagos ADD COLUMN url_checkout text;

-- Un solo pago de seña "abierto" por turno y medio de pago: dos clics en "Pagar" no
-- crean dos preferencias, y no se pueden subir dos comprobantes a la vez.
CREATE UNIQUE INDEX pagos_sena_abierta_uq ON pagos (turno_id, proveedor)
  WHERE concepto = 'SENA' AND estado IN ('PENDIENTE', 'EN_REVISION');

-- Reembolsos: se registran en la misma transacción que detecta el problema (pago
-- tardío, duplicado o insuficiente) y el worker los ejecuta contra Mercado Pago con
-- reintentos. Las transferencias se devuelven a mano desde el panel.
CREATE TYPE estado_reembolso AS ENUM ('PENDIENTE', 'HECHO', 'FALLIDO');

CREATE TABLE reembolsos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  pago_id         uuid NOT NULL UNIQUE REFERENCES pagos(id),   -- un pago se devuelve una sola vez
  monto           bigint NOT NULL CHECK (monto > 0),
  motivo          text NOT NULL,          -- PAGO_TARDIO, PAGO_DUPLICADO, MONTO_INSUFICIENTE, …
  estado          estado_reembolso NOT NULL DEFAULT 'PENDIENTE',
  intentos        smallint NOT NULL DEFAULT 0,
  proximo_intento timestamptz NOT NULL DEFAULT now(),
  error           text,
  external_id     text,                   -- id del refund en Mercado Pago
  creado_en       timestamptz NOT NULL DEFAULT now(),
  hecho_en        timestamptz
);
CREATE INDEX reembolsos_pendientes ON reembolsos (proximo_intento) WHERE estado = 'PENDIENTE';

-- Cada turno ofrecido a la lista de espera corresponde a una sola inscripción.
CREATE UNIQUE INDEX lista_espera_oferta_uq ON lista_espera (oferta_turno_id) WHERE oferta_turno_id IS NOT NULL;
