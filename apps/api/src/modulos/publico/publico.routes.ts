import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config.ts';
import { ErrorNegocio } from '../../errores.ts';
import type { BusTurnos } from '../../plugins/eventos.ts';
import type { RepoClubs } from './club.repo.ts';
import type { ServicioDisponibilidad } from './disponibilidad.service.ts';
import { cuerpoReserva, paramsCodigo, paramsSlug, queryDisponibilidad } from './esquemas.ts';
import type { ServicioReservas } from './reservas.service.ts';

interface Opciones {
  clubs: RepoClubs;
  disponibilidad: ServicioDisponibilidad;
  reservas: ServicioReservas;
  bus: BusTurnos;
  config: Config;
}

const LATIDO_SSE_MS = 25_000;

export const rutasPublicas: FastifyPluginAsync<Opciones> = async (
  app,
  { clubs, disponibilidad, reservas, bus, config },
) => {
  const clubPorSlug = async (params: unknown) => {
    const { slug } = paramsSlug.parse(params);
    const cfg = await clubs.porSlug(slug);
    if (!cfg) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe un club con ese link');
    return cfg;
  };

  app.get('/clubs/:slug', async (req) => {
    const { club, canchas } = await clubPorSlug(req.params);
    return {
      slug: club.slug,
      nombre: club.nombre,
      direccion: club.direccion,
      telefono: club.telefono,
      logoUrl: club.logoUrl,
      zonaHoraria: club.zonaHoraria,
      canchas: canchas.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        jugadoresPorLado: c.jugadoresPorLado,
        superficie: c.superficie,
        techada: c.techada,
        iluminacion: c.iluminacion,
        caracteristicas: c.caracteristicas,
        duracionMin: c.duracionTurnoMin,
      })),
    };
  });

  app.get('/clubs/:slug/disponibilidad', async (req) => {
    const cfg = await clubPorSlug(req.params);
    const q = queryDisponibilidad.parse(req.query);
    return { fecha: q.fecha, canchas: await disponibilidad.jornada(cfg, q.fecha, q) };
  });

  app.post(
    '/clubs/:slug/reservas',
    { config: { rateLimit: { max: config.reservasPorMinuto, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const cfg = await clubPorSlug(req.params);
      const { reserva, creada } = await reservas.crear(cfg, cuerpoReserva.parse(req.body));
      return reply.status(creada ? 201 : 200).send(reserva);
    },
  );

  app.get(
    '/reservas/:codigo',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      const { codigo } = paramsCodigo.parse(req.params);
      return reservas.porCodigo(codigo);
    },
  );

  // Tiempo real: Server-Sent Events. El front, ante cada evento, vuelve a pedir la
  // disponibilidad de ese día (el evento no lleva datos personales).
  const abiertos = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const cerrar of abiertos) cerrar();
  });

  app.get('/clubs/:slug/eventos', async (req, reply) => {
    const cfg = await clubPorSlug(req.params);
    reply.hijack();
    const res = reply.raw;
    // CORS lo agrega Fastify en la reply; con hijack hay que copiarlo a mano.
    const heredados = Object.entries(reply.getHeaders()).filter(
      (h): h is [string, string | number | string[]] => h[1] !== undefined,
    );
    res.writeHead(200, {
      ...Object.fromEntries(heredados),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const desuscribir = bus.suscribir(cfg.club.id, (e) => {
      res.write(
        `event: turno\ndata: ${JSON.stringify({ canchaId: e.canchaId, inicio: e.inicio, estado: e.estado })}\n\n`,
      );
    });
    const latido = setInterval(() => res.write(': ping\n\n'), LATIDO_SSE_MS);
    const cerrar = () => {
      if (!abiertos.delete(cerrar)) return;
      clearInterval(latido);
      desuscribir();
      res.end();
    };
    abiertos.add(cerrar);
    req.raw.on('close', cerrar);
  });
};
