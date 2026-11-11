-- Verificación en dos pasos (TOTP, apps como Google Authenticator) para el panel.
ALTER TABLE usuarios
  -- Secreto en base32. Se guarda al empezar a activarla; vale recién con totp_activo_desde.
  ADD COLUMN totp_secreto text,
  ADD COLUMN totp_activo_desde timestamptz,
  -- Último paso de 30 s usado: el mismo código no sirve dos veces.
  ADD COLUMN totp_ultimo_paso bigint,
  -- Códigos de recuperación de un solo uso (hash sha256 en hex).
  ADD COLUMN codigos_recuperacion text[] NOT NULL DEFAULT '{}';

-- Contraseña correcta, falta el código: el login queda "a medio camino" unos minutos.
CREATE TABLE desafios_dos_pasos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  expira_en   timestamptz NOT NULL,
  intentos    smallint NOT NULL DEFAULT 0,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
