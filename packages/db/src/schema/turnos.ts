import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { estadoTurno, origenTurno } from './enums.ts';
import { tstzrange } from './tipos.ts';

const ts = () => timestamp({ withTimezone: true, mode: 'date' });

/** Plantilla de turno semanal que el worker materializa en `turnos`. */
export const turnosFijos = pgTable('turnos_fijos', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  canchaId: uuid().notNull(),
  clienteId: uuid().notNull(),
  diaSemana: smallint().notNull(),
  horaInicio: time().notNull(),
  duracionMin: smallint().notNull(),
  frecuenciaSemanas: smallint().notNull().default(1),
  vigenteDesde: date({ mode: 'string' }).notNull(),
  vigenteHasta: date({ mode: 'string' }),
  precioPactado: bigint({ mode: 'number' }),
  materializadoHasta: date({ mode: 'string' }),
  activo: boolean().notNull().default(true),
});

/**
 * Turnos. La anti-sobrerreserva la garantiza la constraint `turnos_sin_solapamiento`
 * (EXCLUDE en la migración); al violarla Postgres devuelve 23P01 → ver `esTurnoOcupado()`.
 */
export const turnos = pgTable('turnos', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  canchaId: uuid().notNull(),
  clienteId: uuid(),
  turnoFijoId: uuid(),
  inicio: ts().notNull(),
  fin: ts().notNull(),
  /** Generada por la base: tstzrange(inicio, fin, '[)'). */
  rango: tstzrange().generatedAlwaysAs(sql`tstzrange(inicio, fin, '[)')`),
  estado: estadoTurno().notNull(),
  origen: origenTurno().notNull(),
  precioTotal: bigint({ mode: 'number' }).notNull().default(0),
  montoSena: bigint({ mode: 'number' }).notNull().default(0),
  /** Solo presente (y obligatorio) en PRE_RESERVADO. */
  expiraEn: ts(),
  codigoCheckin: text().notNull().unique().default(sql`encode(gen_random_bytes(16), 'hex')`),
  checkinEn: ts(),
  checkinPor: uuid(),
  idempotencyKey: uuid(),
  creadoPor: uuid(),
  canceladoEn: ts(),
  motivoCancelacion: text(),
  /** Nota interna del club (no se muestra al cliente). */
  nota: text(),
  creadoEn: ts().notNull().defaultNow(),
  actualizadoEn: ts().notNull().defaultNow(),
  /** Bloqueo optimista: lo incrementa un trigger en cada UPDATE. */
  version: integer().notNull().default(0),
});

export const turnosEventos = pgTable('turnos_eventos', {
  id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  turnoId: uuid().notNull(),
  deEstado: estadoTurno(),
  aEstado: estadoTurno().notNull(),
  actor: text().notNull(),
  detalle: jsonb(),
  creadoEn: ts().notNull().defaultNow(),
});
