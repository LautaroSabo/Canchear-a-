-- =============================================================================
-- 0010 — Email para los avisos de cada reserva
-- =============================================================================

-- Los avisos de un turno (confirmación, cancelación, devolución) salen por mail a la
-- dirección que se dejó en ESA reserva. No se toma de la ficha del cliente: si no,
-- alguien podría reservar con el teléfono de otro y su propio email, y recibir sus avisos.
ALTER TABLE turnos ADD COLUMN email_aviso citext;
