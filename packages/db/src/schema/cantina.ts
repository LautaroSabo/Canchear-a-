import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { proveedorPago } from './enums.ts';

const ts = () => timestamp({ withTimezone: true, mode: 'date' });

export type CategoriaProducto = 'BEBIDA' | 'COMIDA' | 'ALQUILER' | 'OTRO';

export const inventarioCantina = pgTable('inventario_cantina', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  nombre: text().notNull(),
  /** BEBIDA, COMIDA, ALQUILER (pelotas, pecheras), OTRO */
  categoria: text().$type<CategoriaProducto>().notNull().default('BEBIDA'),
  precio: bigint({ mode: 'number' }).notNull(),
  /** Los alquileres no descuentan stock. */
  controlaStock: boolean().notNull().default(true),
  stock: integer().notNull().default(0),
  stockMinimo: integer().notNull().default(0),
  activo: boolean().notNull().default(true),
});

/** Ticket de cantina: cobrado en el momento (`medio`) o cargado a la cuenta de un turno. */
export const ventasCantina = pgTable('ventas_cantina', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  turnoId: uuid(),
  medio: proveedorPago(),
  total: bigint({ mode: 'number' }).notNull(),
  idempotencyKey: uuid(),
  creadoPor: uuid(),
  creadoEn: ts().notNull().defaultNow(),
  anuladaEn: ts(),
  anuladaPor: uuid(),
  motivoAnulacion: text(),
});

/** Renglones de una venta. */
export const consumos = pgTable('consumos', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  ventaId: uuid().notNull(),
  productoId: uuid().notNull(),
  cantidad: integer().notNull(),
  /** Congelado al momento de cargar el consumo. */
  precioUnitario: bigint({ mode: 'number' }).notNull(),
  cargadoPor: uuid(),
  creadoEn: ts().notNull().defaultNow(),
});

export const movimientosStock = pgTable('movimientos_stock', {
  id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  clubId: uuid().notNull(),
  productoId: uuid().notNull(),
  tipo: text().$type<'VENTA' | 'ANULACION' | 'REPOSICION' | 'AJUSTE'>().notNull(),
  cantidad: integer().notNull(),
  stockResultante: integer(),
  ventaId: uuid(),
  usuarioId: uuid(),
  motivo: text(),
  creadoEn: ts().notNull().defaultNow(),
});
