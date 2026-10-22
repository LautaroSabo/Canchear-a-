import type { Db } from '@cancheria/db';
import {
  type AlmacenArchivos,
  AlmacenLocal,
  Cifrador,
  type PasarelaMp,
  PasarelaMpHttp,
  type Reloj,
  RepoClubs,
  ServicioAuth,
  ServicioCantina,
  ServicioConfiguracion,
  ServicioFidelizacion,
  ServicioListaEspera,
  ServicioOperacion,
  ServicioPagos,
  ServicioReembolsos,
  ServicioTurnosFijos,
  TAMANO_MAXIMO_COMPROBANTE,
} from '@cancheria/servicios';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import type postgres from 'postgres';
import type { Config } from './config.ts';
import { manejadorErrores } from './errores.ts';
import { rutasAdmin } from './modulos/admin/admin.routes.ts';
import { ConsultasAdmin } from './modulos/admin/consultas.ts';
import { ServicioDisponibilidad } from './modulos/publico/disponibilidad.service.ts';
import { rutasPublicas } from './modulos/publico/publico.routes.ts';
import { ServicioReservas } from './modulos/publico/reservas.service.ts';
import { rutasWebhooks } from './modulos/webhooks/webhooks.routes.ts';
import { BusTurnos, StreamsSse } from './plugins/eventos.ts';

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
  // JSON vacío = sin cuerpo. Por defecto Fastify responde 400, y un front que manda
  // `content-type: application/json` en todos sus fetch rompería los POST sin datos
  // (logout, aprobar, confirmar, pedir el link de MP).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, cuerpo, listo) => {
    if (cuerpo === '') return listo(null, undefined);
    try {
      listo(null, JSON.parse(cuerpo as string));
    } catch {
      listo(Object.assign(new Error('JSON inválido'), { statusCode: 400 }), undefined);
    }
  });
  // credentials: el panel usa cookie de sesión desde el origen del front.
  await app.register(cors, {
    origin: config.origenesWeb,
    credentials: true,
    // El default de @fastify/cors es GET,HEAD,POST: sin esto el panel no puede editar nada.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: TAMANO_MAXIMO_COMPROBANTE, files: 1, fields: 0 } });

  const bus = new BusTurnos();
  const dejarDeEscuchar = await bus.escuchar(cliente, app.log);
  const sse = new StreamsSse(bus);
  app.addHook('preClose', async () => sse.cerrarTodos());
  app.addHook('onClose', async () => dejarDeEscuchar());

  const entorno = { db, reloj, urlWeb: config.urlWeb };
  const cifrador = new Cifrador(config.claveCredenciales);
  const clubs = new RepoClubs(db, config.cacheClubMs);
  const disponibilidad = new ServicioDisponibilidad(db, reloj, config);
  const reservas = new ServicioReservas(db, reloj, config, disponibilidad);
  const pagos = new ServicioPagos({ ...entorno, pasarela, cifrador, almacen, urlApi: config.urlApi });
  const listaEspera = new ServicioListaEspera({ ...entorno, clubs });
  const auth = new ServicioAuth(entorno);
  const operacion = new ServicioOperacion({ ...entorno, clubs, listaEspera });
  const reembolsos = new ServicioReembolsos({ ...entorno, pasarela, cifrador });
  const configuracion = new ServicioConfiguracion({ ...entorno, clubs });
  const turnosFijos = new ServicioTurnosFijos({ ...entorno, clubs, listaEspera });
  const cantina = new ServicioCantina({ ...entorno, clubs });
  const fidelizacion = new ServicioFidelizacion(entorno);
  const consultas = new ConsultasAdmin(db, reloj);

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
    sse,
    config,
  });
  await app.register(rutasWebhooks, { prefix: '/webhooks', clubs, pagos, db, cifrador });
  await app.register(rutasAdmin, {
    prefix: '/admin',
    db,
    config,
    auth,
    cantina,
    clubs,
    consultas,
    configuracion,
    fidelizacion,
    operacion,
    pagos,
    reembolsos,
    turnosFijos,
    pasarela,
    cifrador,
    almacen,
    sse,
  });

  return app;
}
