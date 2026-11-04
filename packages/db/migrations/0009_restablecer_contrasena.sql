-- =============================================================================
-- 0009 — Recuperar la contraseña con un link de un solo uso
-- =============================================================================

-- Se guarda el SHA-256 del token (el token viaja solo en el link). Vence en 1 hora y
-- sirve una vez; pedir uno nuevo anula los anteriores del mismo usuario.
CREATE TABLE restablecimientos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  expira_en   timestamptz NOT NULL,
  usado_en    timestamptz,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restablecimientos_usuario ON restablecimientos (usuario_id, creado_en DESC);
