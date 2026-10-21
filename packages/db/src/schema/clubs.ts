import {
  boolean,
  char,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { rolMiembro } from './enums.ts';
import { bytea, citext, inet } from './tipos.ts';

const ts = () => timestamp({ withTimezone: true, mode: 'date' });

export const clubs = pgTable('clubs', {
  id: uuid().primaryKey().defaultRandom(),
  slug: citext().notNull().unique(),
  nombre: text().notNull(),
  zonaHoraria: text().notNull().default('America/Argentina/Buenos_Aires'),
  telefono: text(),
  direccion: text(),
  logoUrl: text(),
  moneda: char({ length: 3 }).notNull().default('ARS'),
  puntosPorPartido: integer().notNull().default(10),
  minutosRevisionTransferencia: integer().notNull().default(60),
  mpCredencialesCifradas: bytea(),
  datosTransferencia: jsonb().$type<{ alias?: string; cbu?: string; titular?: string }>(),
  activo: boolean().notNull().default(true),
  creadoEn: ts().notNull().defaultNow(),
});

export const usuarios = pgTable('usuarios', {
  id: uuid().primaryKey().defaultRandom(),
  email: citext().notNull().unique(),
  nombre: text().notNull(),
  passwordHash: text().notNull(),
  activo: boolean().notNull().default(true),
  creadoEn: ts().notNull().defaultNow(),
});

/** Sesiones del panel: se guarda el SHA-256 del token de la cookie, nunca el token. */
export const sesiones = pgTable('sesiones', {
  id: uuid().primaryKey().defaultRandom(),
  usuarioId: uuid().notNull(),
  tokenHash: bytea().notNull().unique(),
  creadaEn: ts().notNull().defaultNow(),
  expiraEn: ts().notNull(),
  renovadaEn: ts().notNull().defaultNow(),
  ip: inet(),
  userAgent: text(),
});

export const miembrosClub = pgTable(
  'miembros_club',
  {
    clubId: uuid().notNull(),
    usuarioId: uuid().notNull(),
    rol: rolMiembro().notNull(),
  },
  (t) => [primaryKey({ columns: [t.clubId, t.usuarioId] })],
);

/** 0 = domingo … 6 = sábado. `cierra <= abre` significa que cierra al día siguiente. */
export const horariosApertura = pgTable('horarios_apertura', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  diaSemana: smallint().notNull(),
  abre: time().notNull(),
  cierra: time().notNull(),
});

export const diasEspeciales = pgTable(
  'dias_especiales',
  {
    clubId: uuid().notNull(),
    fecha: date({ mode: 'string' }).notNull(),
    cerrado: boolean().notNull().default(true),
    abre: time(),
    cierra: time(),
    motivo: text(),
  },
  (t) => [primaryKey({ columns: [t.clubId, t.fecha] })],
);
