import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

export const DIR_MIGRACIONES = join(import.meta.dirname, '..', 'migrations');

interface OpcionesMigrar {
  dir?: string;
  log?: (mensaje: string) => void;
}

/**
 * Aplica en orden los archivos `NNNN_nombre.sql` que falten, cada uno en su propia
 * transacción. Un advisory lock evita que dos deploys migren a la vez, y el checksum
 * detecta si alguien editó una migración ya aplicada (en ese caso: migración nueva).
 */
export async function migrar(url: string, { dir = DIR_MIGRACIONES, log = console.log }: OpcionesMigrar = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`SELECT pg_advisory_lock(hashtext('cancheria:migraciones'))`;
    await sql`
      CREATE TABLE IF NOT EXISTS _migraciones (
        nombre      text PRIMARY KEY,
        checksum    text NOT NULL,
        aplicada_en timestamptz NOT NULL DEFAULT now()
      )`;
    const aplicadas = new Map(
      (await sql<{ nombre: string; checksum: string }[]>`SELECT nombre, checksum FROM _migraciones`).map(
        (m) => [m.nombre, m.checksum],
      ),
    );
    const archivos = (await readdir(dir)).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
    let nuevas = 0;

    for (const archivo of archivos) {
      const contenido = await readFile(join(dir, archivo), 'utf8');
      const checksum = createHash('sha256').update(contenido).digest('hex');
      const previo = aplicadas.get(archivo);
      if (previo !== undefined) {
        if (previo !== checksum) {
          throw new Error(`La migración ${archivo} cambió después de aplicarse. Creá una migración nueva.`);
        }
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(contenido);
        await tx`INSERT INTO _migraciones (nombre, checksum) VALUES (${archivo}, ${checksum})`;
      });
      log(`✔ ${archivo}`);
      nuevas++;
    }
    log(nuevas ? `${nuevas} migración(es) aplicada(s).` : 'La base ya está al día.');
  } finally {
    await sql`SELECT pg_advisory_unlock(hashtext('cancheria:migraciones'))`.catch(() => {});
    await sql.end({ timeout: 5 });
  }
}
