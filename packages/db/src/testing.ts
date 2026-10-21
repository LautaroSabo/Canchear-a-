import postgres from 'postgres';
import { migrar } from './migrador.ts';

/**
 * Crea una base temporal en el servidor de DATABASE_URL con las migraciones reales
 * aplicadas. Pensado para el globalSetup de Vitest: nunca toca la base de desarrollo.
 */
export async function crearBaseDeTest(prefijo = 'cancheria_test') {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Los tests necesitan DATABASE_URL (ver .env.example)');

  const nombre = `${prefijo}_${process.pid}_${Date.now()}`;
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${nombre}"`);

  const url = new URL(base);
  url.pathname = `/${nombre}`;
  await migrar(url.toString(), { log: () => {} });

  return {
    url: url.toString(),
    borrar: async () => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
