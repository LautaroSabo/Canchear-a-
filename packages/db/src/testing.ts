import { randomBytes } from 'node:crypto';
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

/**
 * Clona una base ya migrada (la de `crearBaseDeTest`) para que un test tenga datos
 * propios: útil cuando lo que se prueba opera sobre toda la base (barridos del worker).
 * `CREATE DATABASE … TEMPLATE` copia archivos, así que es casi instantáneo.
 */
export async function clonarBaseDeTest(urlPlantilla: string) {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Los tests necesitan DATABASE_URL (ver .env.example)');
  const plantilla = new URL(urlPlantilla).pathname.slice(1);
  const nombre = `${plantilla}_${randomBytes(4).toString('hex')}`;
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  // Postgres no permite clonar mientras otro CREATE DATABASE lee la misma plantilla.
  for (let intento = 0; ; intento++) {
    try {
      await admin.unsafe(`CREATE DATABASE "${nombre}" TEMPLATE "${plantilla}"`);
      break;
    } catch (e) {
      if (intento >= 20 || !String(e).includes('is being accessed by other users')) throw e;
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
    }
  }
  const url = new URL(urlPlantilla);
  url.pathname = `/${nombre}`;
  return {
    url: url.toString(),
    borrar: async () => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
