import { bigint, boolean, date, jsonb, pgTable, smallint, text, time, uuid } from 'drizzle-orm/pg-core';
import { tipoSuperficie } from './enums.ts';

export const canchas = pgTable('canchas', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  nombre: text().notNull(),
  jugadoresPorLado: smallint().notNull(),
  superficie: tipoSuperficie().notNull().default('SINTETICO'),
  techada: boolean().notNull().default(false),
  iluminacion: boolean().notNull().default(true),
  caracteristicas: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  duracionTurnoMin: smallint().notNull().default(60),
  orden: smallint().notNull().default(0),
  activa: boolean().notNull().default(true),
});

/** Precio por franja. `canchaId` null = precio general del club; `diaSemana` null = todos los días. */
export const tarifas = pgTable('tarifas', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  canchaId: uuid(),
  diaSemana: smallint(),
  horaDesde: time().notNull(),
  horaHasta: time().notNull(),
  /** centavos por turno */
  precio: bigint({ mode: 'number' }).notNull(),
  etiqueta: text(),
  vigenteDesde: date({ mode: 'string' }).notNull().defaultNow(),
  vigenteHasta: date({ mode: 'string' }),
});
