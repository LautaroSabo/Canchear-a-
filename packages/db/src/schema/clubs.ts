import { sql } from 'drizzle-orm';
import {
  bigint,
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
  /** Hasta cuántas horas antes el jugador cancela online (con devolución). 0 = no puede. */
  horasCancelacion: integer().notNull().default(24),
  /** Cuántas horas antes del partido se manda el recordatorio por mail. 0 = no se manda. */
  horasRecordatorio: integer().notNull().default(3),
  mpCredencialesCifradas: bytea(),
  datosTransferencia: jsonb().$type<{ alias?: string; cbu?: string; titular?: string }>(),
  activo: boolean().notNull().default(true),
  creadoEn: ts().notNull().defaultNow(),
  /** PENDIENTE (espera aprobación) · ACTIVO (toma reservas) · SUSPENDIDO. */
  estado: text().$type<EstadoClub>().notNull().default('ACTIVO'),
  aprobadoEn: ts(),
  motivoSuspension: text(),
  /** Suscripción de Mercado Pago para el abono (cuenta de la plataforma). */
  mpSuscripcionId: text().unique(),
  mpSuscripcionEstado: text(),
  mpSuscripcionEmail: text(),
  /** La suspendió el sistema por abono vencido: se reactiva sola cuando entra el pago. */
  suspendidoPorAbono: boolean().notNull().default(false),
  /** Último día cubierto por el abono mensual (incluye la prueba). */
  abonoHasta: date({ mode: 'string' }),
});

export type EstadoClub = 'PENDIENTE' | 'ACTIVO' | 'SUSPENDIDO';

/** Pagos del abono que cada club le hace a la plataforma. */
export const pagosAbono = pgTable('pagos_abono', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  monto: bigint({ mode: 'number' }).notNull(),
  meses: integer().notNull(),
  desde: date({ mode: 'string' }).notNull(),
  hasta: date({ mode: 'string' }).notNull(),
  medio: text().notNull(),
  nota: text(),
  registradoPor: uuid(),
  /** Id del pago en Mercado Pago (cobro automático): se registra una sola vez. */
  mpPagoId: text().unique(),
  creadoEn: ts().notNull().defaultNow(),
});

export const usuarios = pgTable('usuarios', {
  id: uuid().primaryKey().defaultRandom(),
  email: citext().notNull().unique(),
  nombre: text().notNull(),
  passwordHash: text().notNull(),
  activo: boolean().notNull().default(true),
  esSuperadmin: boolean().notNull().default(false),
  /** Términos aceptados al registrar el club (null: cuenta creada por otro usuario o CLI). */
  terminosVersion: text(),
  terminosAceptadosEn: ts(),
  /** Verificación en dos pasos: secreto TOTP (base32); vale cuando hay totpActivoDesde. */
  totpSecreto: text(),
  totpActivoDesde: ts(),
  totpUltimoPaso: bigint({ mode: 'number' }),
  /** Hash sha256 (hex) de los códigos de recuperación sin usar. */
  codigosRecuperacion: text().array().notNull().default(sql`'{}'::text[]`),
  creadoEn: ts().notNull().defaultNow(),
});

/** Links de un solo uso para elegir una contraseña nueva (se guarda el hash del token). */
export const restablecimientos = pgTable('restablecimientos', {
  id: uuid().primaryKey().defaultRandom(),
  usuarioId: uuid().notNull(),
  tokenHash: bytea().notNull().unique(),
  expiraEn: ts().notNull(),
  usadoEn: ts(),
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

/** Login con contraseña correcta que todavía espera el código de dos pasos. */
export const desafiosDosPasos = pgTable('desafios_dos_pasos', {
  id: uuid().primaryKey().defaultRandom(),
  usuarioId: uuid().notNull(),
  tokenHash: bytea().notNull().unique(),
  expiraEn: ts().notNull(),
  intentos: smallint().notNull().default(0),
  creadoEn: ts().notNull().defaultNow(),
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
