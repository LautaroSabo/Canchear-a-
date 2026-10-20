import { is } from 'drizzle-orm';
import { toSnakeCase } from 'drizzle-orm/casing';
import { getTableConfig, isPgEnum, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { crearDb } from '../src/client.ts';
import * as schema from '../src/schema/index.ts';

// Las migraciones SQL son la fuente de verdad; este test asegura que el esquema
// Drizzle (usado para tipar las consultas) describe exactamente lo mismo.

const { cliente, cerrar } = crearDb(inject('databaseUrl'), { max: 1 });
afterAll(cerrar);

const exportados: unknown[] = Object.values(schema);
const tablas = exportados.filter((v): v is PgTable => is(v, PgTable));
const enums = exportados.filter(isPgEnum);
const nombreColumna = (c: { name: string; keyAsName: boolean }) =>
  c.keyAsName ? toSnakeCase(c.name) : c.name;

interface ColumnaDb {
  column_name: string;
  is_nullable: 'YES' | 'NO';
  udt_name: string;
}

describe('schema drift (Drizzle vs migraciones)', () => {
  it('existen las mismas tablas', async () => {
    const enDb = await cliente<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_migraciones'`;
    expect(tablas.map((t) => getTableConfig(t).name).sort()).toEqual(enDb.map((t) => t.table_name).sort());
  });

  it.each(tablas.map((t) => [getTableConfig(t).name, t] as const))(
    '%s: columnas, tipos y nulabilidad',
    async (nombre, tabla) => {
      const enDb = await cliente<ColumnaDb[]>`
      SELECT column_name, is_nullable, udt_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${nombre}`;
      const db = Object.fromEntries(enDb.map((c) => [c.column_name, c]));

      const drizzle = getTableConfig(tabla).columns.map((c) => ({
        columna: nombreColumna(c),
        notNull: c.notNull,
        tipo: c.getSQLType(),
      }));
      expect(drizzle.map((c) => c.columna).sort()).toEqual(Object.keys(db).sort());

      for (const c of drizzle) {
        const real = db[c.columna];
        expect.soft(c.notNull, `${nombre}.${c.columna} NOT NULL`).toBe(real?.is_nullable === 'NO');
        expect.soft(normalizarTipo(c.tipo), `${nombre}.${c.columna} tipo`).toBe(real?.udt_name);
      }
    },
  );

  it.each(enums.map((e) => [e.enumName, e] as const))(
    'enum %s: mismos valores y orden',
    async (nombre, e) => {
      const valores = await cliente<{ v: string }[]>`
      SELECT enumlabel AS v FROM pg_enum JOIN pg_type t ON t.oid = enumtypid
       WHERE t.typname = ${nombre} ORDER BY enumsortorder`;
      expect(e.enumValues).toEqual(valores.map((r) => r.v));
    },
  );
});

/** Traduce el tipo SQL que declara Drizzle al `udt_name` de information_schema. */
function normalizarTipo(tipo: string): string {
  const base = tipo.replace(/\(.*\)/, '').trim();
  const mapa: Record<string, string> = {
    'timestamp with time zone': 'timestamptz',
    smallint: 'int2',
    integer: 'int4',
    bigint: 'int8',
    boolean: 'bool',
    char: 'bpchar',
  };
  return mapa[base] ?? base;
}
