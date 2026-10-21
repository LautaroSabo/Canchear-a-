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
