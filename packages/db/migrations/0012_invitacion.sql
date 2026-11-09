-- Link para pasarle el partido al grupo: distinto del código del comprobante, que permite
-- cancelar y ver datos del que reservó. El DEFAULT volátil se calcula fila por fila.
ALTER TABLE turnos
  ADD COLUMN codigo_invitacion text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex');
