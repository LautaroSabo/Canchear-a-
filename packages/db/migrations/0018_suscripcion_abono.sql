-- Cobro automático del abono con una suscripción de Mercado Pago (cuenta de la plataforma).
ALTER TABLE clubs
  ADD COLUMN mp_suscripcion_id text UNIQUE,
  -- pending | authorized | paused | cancelled (como lo informa Mercado Pago)
  ADD COLUMN mp_suscripcion_estado text,
  ADD COLUMN mp_suscripcion_email text,
  -- La suspendió el sistema por abono vencido: se reactiva sola cuando entra el pago.
  ADD COLUMN suspendido_por_abono boolean NOT NULL DEFAULT false;

-- Un cobro de MP se registra una sola vez aunque el aviso llegue repetido.
ALTER TABLE pagos_abono ADD COLUMN mp_pago_id text UNIQUE;
