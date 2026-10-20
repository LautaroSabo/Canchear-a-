// Fuente de verdad del esquema: packages/db/migrations/*.sql (constraints, triggers,
// EXCLUDE, índices parciales). Estos archivos describen las mismas tablas para tener
// consultas tipadas; test/schema-drift.test.ts falla si se desincronizan.
export * from './canchas.ts';
export * from './cantina.ts';
export * from './clientes.ts';
export * from './clubs.ts';
export * from './enums.ts';
export * from './fidelizacion.ts';
export * from './operacion.ts';
export * from './pagos.ts';
export * from './turnos.ts';
