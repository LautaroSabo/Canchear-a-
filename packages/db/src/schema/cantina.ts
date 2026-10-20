import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const inventarioCantina = pgTable('inventario_cantina', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  nombre: text().notNull(),
  /** BEBIDA, COMIDA, ALQUILER (pelotas, pecheras) */
  categoria: text().notNull().default('BEBIDA'),
  precio: bigint({ mode: 'number' }).notNull(),
  /** Los alquileres no descuentan stock. */
  controlaStock: boolean().notNull().default(true),
  stock: integer().notNull().default(0),
  stockMinimo: integer().notNull().default(0),
  activo: boolean().notNull().default(true),
});

export const consumos = pgTable('consumos', {
  id: uuid().primaryKey().defaultRandom(),
  clubId: uuid().notNull(),
  turnoId: uuid().notNull(),
  productoId: uuid().notNull(),
  cantidad: integer().notNull(),
  /** Congelado al momento de cargar el consumo. */
  precioUnitario: bigint({ mode: 'number' }).notNull(),
  cargadoPor: uuid(),
  creadoEn: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
