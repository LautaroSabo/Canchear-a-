-- =============================================================================
-- 0003 — Panel de administración: sesiones y notas internas de turnos
-- =============================================================================

ALTER TABLE usuarios ADD COLUMN activo boolean NOT NULL DEFAULT true;

-- Sesiones del panel. La cookie lleva un token aleatorio de 256 bits; acá se guarda
-- solo su SHA-256, así una fuga de la base no permite usar las sesiones.
CREATE TABLE sesiones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  creada_en   timestamptz NOT NULL DEFAULT now(),
  expira_en   timestamptz NOT NULL,
  renovada_en timestamptz NOT NULL DEFAULT now(),
  ip          inet,
  user_agent  text
);
CREATE INDEX sesiones_usuario ON sesiones (usuario_id);
CREATE INDEX sesiones_vencimiento ON sesiones (expira_en);

-- Nota interna del club sobre un turno ("Mantenimiento", "Cumpleaños de Juan", …).
ALTER TABLE turnos ADD COLUMN nota text CHECK (char_length(nota) <= 500);
