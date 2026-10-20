import { bigint, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conceptoPago, estadoPago, proveedorPago } from './enums.ts';

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
  comprobanteUrl: text(),
  revisadoPor: uuid(),
  payload: jsonb(),
  creadoEn: ts().notNull().defaultNow(),
  acreditadoEn: ts(),
});
