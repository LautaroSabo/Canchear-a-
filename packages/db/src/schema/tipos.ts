import { customType } from 'drizzle-orm/pg-core';

/** Texto case-insensitive (extensión citext). */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/** Binario (credenciales cifradas). */
export const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/**
 * tstzrange tal como lo devuelve Postgres, ej. `["2026-10-24 23:00:00+00","2026-10-25 00:00:00+00")`.
 * En `turnos` es una columna generada: se lee, nunca se escribe.
 */
export const tstzrange = customType<{ data: string }>({ dataType: () => 'tstzrange' });
