import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { citext } from './tipos.ts';

export const clientes = pgTable('clientes', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  nombre: text().notNull(),
  telefonoE164: text('telefono_e164').notNull(),
  dni: text(),
  email: citext(),
  /** Caché de SUM(movimientos_puntos.puntos); nunca negativa. */
  saldoPuntos: integer().notNull().default(0),
  bloqueado: boolean().notNull().default(false),
  notas: text(),
  creadoEn: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
