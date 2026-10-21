import type { Db } from '@cancheria/db';
import {
  type AlmacenArchivos,
  AlmacenLocal,
  Cifrador,
  type PasarelaMp,
  PasarelaMpHttp,
  type Reloj,
  RepoClubs,
  ServicioListaEspera,
  ServicioPagos,
  TAMANO_MAXIMO_COMPROBANTE,
} from '@cancheria/servicios';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import type postgres from 'postgres';
import type { Config } from './config.ts';
import { manejadorErrores } from './errores.ts';
import { ServicioDisponibilidad } from './modulos/publico/disponibilidad.service.ts';
import { rutasPublicas } from './modulos/publico/publico.routes.ts';
import { ServicioReservas } from './modulos/publico/reservas.service.ts';
import { rutasWebhooks } from './modulos/webhooks/webhooks.routes.ts';
import { BusTurnos } from './plugins/eventos.ts';

export type { Reloj } from '@cancheria/servicios';

export interface Dependencias {
  db: Db;
  /** Cliente de postgres.js subyacente (para LISTEN). */
  cliente: postgres.Sql;
  config: Config;
  reloj?: Reloj;
  logger?: boolean;
  /** Mercado Pago real por defecto; los tests inyectan una pasarela falsa. */
  pasarela?: PasarelaMp;
  almacen?: AlmacenArchivos;
}

export async function construirApp({
  db,
  cliente,
  config,
  reloj = () => new Date(),
  logger = true,
  pasarela = new PasarelaMpHttp(),
  almacen = new AlmacenLocal(config.dirComprobantes),
}: Dependencias) {
  const app = Fastify({
    logger: logger && {
      level: config.nivelLog,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-signature"]'],
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
  await app.register(multipart, { limits: { fileSize: TAMANO_MAXIMO_COMPROBANTE, files: 1, fields: 0 } });

  const bus = new BusTurnos();
  const dejarDeEscuchar = await bus.escuchar(cliente, app.log);
  app.addHook('onClose', async () => dejarDeEscuchar());

  const entorno = { db, reloj, urlWeb: config.urlWeb };
  const cifrador = new Cifrador(config.claveCredenciales);
  const clubs = new RepoClubs(db, config.cacheClubMs);
  const disponibilidad = new ServicioDisponibilidad(db, reloj, config);
  const reservas = new ServicioReservas(db, reloj, config, disponibilidad);
  const pagos = new ServicioPagos({ ...entorno, pasarela, cifrador, almacen, urlApi: config.urlApi });
  const listaEspera = new ServicioListaEspera({ ...entorno, clubs });

  app.get('/health', async () => {
    await db.execute(sql`SELECT 1`);
    return { ok: true };
  });

  await app.register(rutasPublicas, {
    prefix: '/public',
    clubs,
    disponibilidad,
    reservas,
    pagos,
    listaEspera,
    bus,
    config,
  });
  await app.register(rutasWebhooks, { prefix: '/webhooks', clubs, pagos, db, cifrador });

  return app;
}
