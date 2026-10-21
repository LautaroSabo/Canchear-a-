import { randomUUID } from 'node:crypto';
import { crearClubDemo, crearDb } from '@cancheria/db';
import { inject } from 'vitest';
import { construirApp } from '../src/app.ts';
import { cargarConfig } from '../src/config.ts';

/** Viernes 2030-01-04 12:00 en Buenos Aires. */
export const AHORA = new Date('2030-01-04T12:00:00-03:00');
/** Fecha/hora local de Buenos Aires → ISO con offset, como lo manda el front. */
export const ba = (fecha: string, hora: string) => `${fecha}T${hora}:00-03:00`;
export const iso = (fecha: string, hora: string) => new Date(ba(fecha, hora)).toISOString();

/**
 * App completa contra la base de test, con un club demo propio (slug aleatorio) y un
 * reloj controlable. Misma config que producción salvo caché y rate limit.
 */
export async function crearContexto({ pool = 10 }: { pool?: number } = {}) {
  const url = inject('databaseUrl');
  const conexion = crearDb(url, { max: pool });
  let ahora = AHORA;
  const config = {
    ...cargarConfig({ DATABASE_URL: url, NODE_ENV: 'test' }),
    cacheClubMs: 0,
    reservasPorMinuto: 10_000,
  };
  const app = await construirApp({
    db: conexion.db,
    cliente: conexion.cliente,
    config,
    reloj: () => ahora,
    logger: false,
  });
  const slug = `club-${randomUUID().slice(0, 8)}`;
  const { club, canchas } = await crearClubDemo(conexion.db, slug);
  const [f5a, f5b, f7] = canchas;

  return {
    app,
    db: conexion.db,
    club,
    slug,
    canchas: { f5a, f5b, f7 },
    setAhora: (d: Date) => {
      ahora = d;
    },
    cerrar: async () => {
      await app.close();
      await conexion.cerrar();
    },
  };
}

export type Contexto = Awaited<ReturnType<typeof crearContexto>>;

let contador = 0;
export function pedido(
  canchaId: string,
  inicio: string,
  cliente: Partial<{ nombre: string; telefono: string; dni: string }> = {},
) {
  contador++;
  return {
    canchaId,
    inicio,
    cliente: {
      nombre: `Jugador ${contador}`,
      telefono: `+54911${String(50_000_000 + contador)}`,
      ...cliente,
    },
    idempotencyKey: randomUUID(),
  };
}

export function reservar(ctx: Contexto, cuerpo: ReturnType<typeof pedido>) {
  return ctx.app.inject({ method: 'POST', url: `/public/clubs/${ctx.slug}/reservas`, payload: cuerpo });
}
