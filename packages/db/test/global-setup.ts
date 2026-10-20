import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { migrar } from '../src/migrador.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Crea una base temporal en el servidor de DATABASE_URL, le aplica las migraciones
 * reales y la borra al terminar. Así los tests nunca tocan la base de desarrollo.
 */
export default async function setup(project: TestProject) {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Los tests necesitan DATABASE_URL (ver .env.example)');

  const nombre = `cancheria_test_${process.pid}_${Date.now()}`;
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${nombre}"`);

  const url = new URL(base);
  url.pathname = `/${nombre}`;
  await migrar(url.toString(), { log: () => {} });
  project.provide('databaseUrl', url.toString());

  return async () => {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await admin.end();
  };
}
