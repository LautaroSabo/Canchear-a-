import { bigint, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conceptoPago, estadoPago, estadoReembolso, proveedorPago } from './enums.ts';

const ts = () => timestamp({ withTimezone: true, mode: 'date' });

export const pagos = pgTable('pagos', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  turnoId: uuid().notNull(),
  proveedor: proveedorPago().notNull(),
  concepto: conceptoPago().notNull(),
  estado: estadoPago().notNull().default('PENDIENTE'),
  /** centavos */
  monto: bigint({ mode: 'number' }).notNull(),
  /** id del pago en el proveedor; único por proveedor → webhooks idempotentes. */
  externalId: text(),
  preferenciaId: text(),
  urlCheckout: text(),
  comprobanteUrl: text(),
  revisadoPor: uuid(),
  payload: jsonb(),
  creadoEn: ts().notNull().defaultNow(),
  acreditadoEn: ts(),
});

export const reembolsos = pgTable('reembolsos', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  pagoId: uuid().notNull().unique(),
  monto: bigint({ mode: 'number' }).notNull(),
  motivo: text().notNull(),
  estado: estadoReembolso().notNull().default('PENDIENTE'),
  intentos: smallint().notNull().default(0),
  proximoIntento: ts().notNull().defaultNow(),
  error: text(),
  externalId: text(),
  creadoEn: ts().notNull().defaultNow(),
  hechoEn: ts(),
});

/** Cierre de caja: lo cobrado entre el cierre anterior y este, y el efectivo contado. */
export const cierresCaja = pgTable('cierres_caja', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  desde: ts().notNull(),
  hasta: ts().notNull(),
  usuarioId: uuid().notNull(),
  /** centavos */
  efectivoEsperado: bigint({ mode: 'number' }).notNull(),
  efectivoContado: bigint({ mode: 'number' }).notNull(),
  detalle: jsonb().$type<Record<string, unknown>>().notNull(),
  nota: text(),
  creadoEn: ts().notNull().defaultNow(),
});
