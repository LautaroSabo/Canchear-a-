-- Constancia de aceptación de los Términos y la Política de privacidad (versión = fecha).
ALTER TABLE usuarios
  ADD COLUMN terminos_version text,
  ADD COLUMN terminos_aceptados_en timestamptz;
ALTER TABLE turnos ADD COLUMN terminos_version text;
