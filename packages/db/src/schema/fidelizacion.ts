import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { estadoCanje, tipoMovPuntos, tipoPremio } from './enums.ts';

const ts = () => timestamp({ withTimezone: true, mode: 'date' });

export const promocionesPuntos = pgTable('promociones_puntos', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  nombre: text().notNull(),
  diaSemana: smallint(),
  horaDesde: time(),
  horaHasta: time(),
  multiplicador: numeric({ precision: 4, scale: 2 }).notNull(),
  puntosExtra: integer().notNull().default(0),
  vigenteDesde: date({ mode: 'string' }).notNull().defaultNow(),
  vigenteHasta: date({ mode: 'string' }),
  activa: boolean().notNull().default(true),
});

export const premios = pgTable('premios', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  nombre: text().notNull(),
  descripcion: text(),
  costoPuntos: integer().notNull(),
  tipo: tipoPremio().notNull(),
  /** centavos o porcentaje según `tipo` */
  valor: bigint({ mode: 'number' }).notNull().default(0),
  /** null = ilimitado */
  stock: integer(),
  activo: boolean().notNull().default(true),
});

export const canjes = pgTable('canjes', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  clienteId: uuid().notNull(),
  premioId: uuid().notNull(),
  puntos: integer().notNull(),
  codigo: text().notNull().unique().default(sql`upper(encode(gen_random_bytes(5), 'hex'))`),
  estado: estadoCanje().notNull().default('EMITIDO'),
  turnoId: uuid(),
  creadoEn: ts().notNull().defaultNow(),
  /** Lo que el canje le descontó al turno (centavos). */
  montoAplicado: bigint({ mode: 'number' }).notNull().default(0),
  usadoEn: ts(),
  creadoPor: uuid(),
  anuladoEn: ts(),
  motivoAnulacion: text(),
});

/** Ledger append-only de puntos (negativos en CANJE). */
export const movimientosPuntos = pgTable('movimientos_puntos', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  clienteId: uuid().notNull(),
  tipo: tipoMovPuntos().notNull(),
  puntos: integer().notNull(),
  turnoId: uuid(),
  canjeId: uuid(),
  promocionId: uuid(),
  creadoEn: ts().notNull().defaultNow(),
  usuarioId: uuid(),
  motivo: text(),
});
