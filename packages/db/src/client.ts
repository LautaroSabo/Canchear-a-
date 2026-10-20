import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export type OpcionesConexion = postgres.Options<Record<string, postgres.PostgresType>>;

/**
 * Crea un pool de conexiones y la instancia de Drizzle. Las propiedades camelCase
 * del esquema se mapean a snake_case en SQL (`casing`).
 */
export function crearDb(url: string, opciones: OpcionesConexion = {}) {
  const cliente = postgres(url, { max: 10, onnotice: () => {}, ...opciones });
  const db = drizzle({ client: cliente, schema, casing: 'snake_case' });
  return { db, cliente, cerrar: () => cliente.end({ timeout: 5 }) };
}

export type Db = ReturnType<typeof crearDb>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function urlDesdeEntorno(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (copiá .env.example a .env)');
  return url;
}
