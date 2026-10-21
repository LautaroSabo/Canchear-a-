import type { Db } from '@cancheria/db';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import type postgres from 'postgres';
import type { Config } from './config.ts';
import { manejadorErrores } from './errores.ts';
import { RepoClubs } from './modulos/publico/club.repo.ts';
import { ServicioDisponibilidad } from './modulos/publico/disponibilidad.service.ts';
import { rutasPublicas } from './modulos/publico/publico.routes.ts';
import { ServicioReservas } from './modulos/publico/reservas.service.ts';
import { BusTurnos } from './plugins/eventos.ts';

export type Reloj = () => Date;

export interface Dependencias {
  db: Db;
  /** Cliente de postgres.js subyacente (para LISTEN). */
  cliente: postgres.Sql;
  config: Config;
  reloj?: Reloj;
  logger?: boolean;
}

export async function construirApp({
  db,
  cliente,
  config,
  reloj = () => new Date(),
  logger = true,
}: Dependencias) {
  const app = Fastify({
    logger: logger && {
      level: config.nivelLog,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      ...(config.logsLegibles ? { transport: { target: 'pino-pretty' } } : {}),
    },
    trustProxy: true,
    bodyLimit: 64 * 1024,
    // Al apagar se cortan también las conexiones SSE abiertas (el navegador reconecta solo).
    forceCloseConnections: true,
  });

  app.setErrorHandler(manejadorErrores);
  await app.register(cors, { origin: config.origenesWeb });
  await app.register(rateLimit, { global: false });

  const bus = new BusTurnos();
  const dejarDeEscuchar = await bus.escuchar(cliente, app.log);
  app.addHook('onClose', async () => dejarDeEscuchar());

  const clubs = new RepoClubs(db, config.cacheClubMs);
  const disponibilidad = new ServicioDisponibilidad(db, reloj, config);
  const reservas = new ServicioReservas(db, reloj, config, disponibilidad);

  app.get('/health', async () => {
    await db.execute(sql`SELECT 1`);
    return { ok: true };
  });

  await app.register(rutasPublicas, { prefix: '/public', clubs, disponibilidad, reservas, bus, config });

  return app;
}
