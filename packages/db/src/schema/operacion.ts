import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { canalNotif, estadoEspera, estadoNotif, tipoSena } from './enums.ts';

const ts = () => timestamp({ withTimezone: true, mode: 'date' });

/**
 * Reglas de seña + timer. Los campos null actúan como comodín; gana la de mayor
 * prioridad y, a igual prioridad, la más específica (cancha > día > franja).
 */
export const configuracionExpiracion = pgTable('configuracion_expiracion', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  nombre: text().notNull(),
  canchaId: uuid(),
  diaSemana: smallint(),
  horaDesde: time(),
  horaHasta: time(),
  requiereSena: boolean().notNull(),
  tipoSena: tipoSena().notNull().default('PORCENTAJE'),
  /** Porcentaje (0-100) o centavos, según `tipoSena`. */
  valorSena: bigint({ mode: 'number' }).notNull().default(50),
  minutosExpiracion: integer().notNull().default(30),
  margenMinAntesInicio: integer().notNull().default(15),
  prioridad: smallint().notNull().default(0),
  activa: boolean().notNull().default(true),
});

export const listaEspera = pgTable('lista_espera', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  clienteId: uuid().notNull(),
  canchaId: uuid(),
  jugadoresPorLado: smallint(),
  desde: ts().notNull(),
  hasta: ts().notNull(),
  duracionMin: smallint().notNull().default(60),
  estado: estadoEspera().notNull().default('ACTIVA'),
  notificadaEn: ts(),
  ofertaTurnoId: uuid(),
  creadoEn: ts().notNull().defaultNow(),
});

/** Outbox: se inserta en la misma transacción que el cambio de negocio. */
export const notificaciones = pgTable('notificaciones', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  clienteId: uuid(),
  canal: canalNotif().notNull(),
  destino: text().notNull(),
  plantilla: text().notNull(),
  payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  estado: estadoNotif().notNull().default('PENDIENTE'),
  intentos: smallint().notNull().default(0),
  proximoIntento: ts().notNull().defaultNow(),
  error: text(),
  creadoEn: ts().notNull().defaultNow(),
  enviadaEn: ts(),
});
