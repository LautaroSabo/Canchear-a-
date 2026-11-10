-- Cierre de caja: lo cobrado entre el cierre anterior y este, por medio de pago, y el
-- efectivo que contó el encargado. Cada cierre arranca donde terminó el anterior.
CREATE TABLE cierres_caja (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id            uuid NOT NULL REFERENCES clubs(id),
  desde              timestamptz NOT NULL,
  hasta              timestamptz NOT NULL,
  usuario_id         uuid NOT NULL REFERENCES usuarios(id),
  efectivo_esperado  bigint NOT NULL,
  efectivo_contado   bigint NOT NULL CHECK (efectivo_contado >= 0),
  -- Lo mismo que muestra la pantalla al cerrar (por medio, turnos, cantina, devoluciones).
  detalle            jsonb NOT NULL,
  nota               text,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  CHECK (hasta > desde)
);
CREATE INDEX cierres_caja_club ON cierres_caja (club_id, hasta DESC);
