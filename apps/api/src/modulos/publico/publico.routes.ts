import { instanteLocal, sumarDias } from '@cancheria/core';
import {
  ErrorNegocio,
  type RepoClubs,
  type ServicioListaEspera,
  type ServicioPagos,
} from '@cancheria/servicios';
import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config.ts';
import type { StreamsSse } from '../../plugins/eventos.ts';
import type { ServicioDisponibilidad } from './disponibilidad.service.ts';
import {
  cuerpoListaEspera,
  cuerpoReserva,
  paramsCodigo,
  paramsSlug,
  queryDisponibilidad,
} from './esquemas.ts';
import type { ServicioReservas } from './reservas.service.ts';

interface Opciones {
  clubs: RepoClubs;
  disponibilidad: ServicioDisponibilidad;
  reservas: ServicioReservas;
  pagos: ServicioPagos;
  listaEspera: ServicioListaEspera;
  sse: StreamsSse;
  config: Config;
}

export const rutasPublicas: FastifyPluginAsync<Opciones> = async (
  app,
  { clubs, disponibilidad, reservas, pagos, listaEspera, sse, config },
) => {
  const clubPorSlug = async (params: unknown) => {
    const { slug } = paramsSlug.parse(params);
    const cfg = await clubs.porSlug(slug);
    if (!cfg) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe un club con ese link');
    return cfg;
  };

  app.get('/clubs/:slug', async (req) => {
    const { club, canchas, mediosPago } = await clubPorSlug(req.params);
    return {
      slug: club.slug,
      nombre: club.nombre,
      direccion: club.direccion,
      telefono: club.telefono,
      logoUrl: club.logoUrl,
      zonaHoraria: club.zonaHoraria,
      mediosPago,
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

  // --- Seña -----------------------------------------------------------------

  /** Link de pago de Mercado Pago (se reusa si ya existe). */
  app.post(
    '/reservas/:codigo/mercadopago',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const { codigo } = paramsCodigo.parse(req.params);
      return pagos.checkoutMp(codigo);
    },
  );

  /** Comprobante de transferencia (multipart, campo `comprobante`: JPG/PNG/WEBP/PDF ≤ 5 MB). */
  app.post(
    '/reservas/:codigo/transferencia',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { codigo } = paramsCodigo.parse(req.params);
      if (!req.isMultipart())
        throw new ErrorNegocio(415, 'SE_ESPERABA_ARCHIVO', 'Enviá el comprobante como archivo');
      const archivo = await req.file();
      if (archivo?.fieldname !== 'comprobante') {
        throw new ErrorNegocio(400, 'SE_ESPERABA_ARCHIVO', 'Falta el archivo "comprobante"');
      }
      const resultado = await pagos.registrarTransferencia(codigo, await archivo.toBuffer());
      return reply.status(201).send(resultado);
    },
  );

  /** Acepta un turno ofrecido por la lista de espera que no pide seña. */
  app.post('/reservas/:codigo/confirmar', async (req) => {
    const { codigo } = paramsCodigo.parse(req.params);
    await pagos.confirmarSinSena(codigo);
    return reservas.porCodigo(codigo);
  });

  // --- Lista de espera -------------------------------------------------------

  app.post(
    '/clubs/:slug/lista-espera',
    { config: { rateLimit: { max: config.reservasPorMinuto, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const cfg = await clubPorSlug(req.params);
      const p = cuerpoListaEspera.parse(req.body);
      disponibilidad.validarFecha(cfg, p.fecha);
      const zona = cfg.club.zonaHoraria;
      const fechaHasta = p.hasta <= p.desde ? sumarDias(p.fecha, 1) : p.fecha;
      const inscripcion = await listaEspera.inscribir(cfg, {
        cliente: p.cliente,
        desde: instanteLocal(p.fecha, p.desde, zona),
        hasta: instanteLocal(fechaHasta, p.hasta, zona),
        canchaId: p.canchaId,
        jugadoresPorLado: p.jugadores,
      });
      return reply.status(201).send(inscripcion);
    },
  );

  // Tiempo real: Server-Sent Events (ver StreamsSse).
  app.get('/clubs/:slug/eventos', async (req, reply) => {
    const cfg = await clubPorSlug(req.params);
    sse.abrir(req, reply, cfg.club.id);
  });
};
