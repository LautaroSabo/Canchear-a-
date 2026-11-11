import { instanteLocal, sumarDias } from '@cancheria/core';
import {
  ErrorNegocio,
  type RepoClubs,
  type ServicioListaEspera,
  type ServicioOperacion,
  type ServicioPagos,
  type ServicioPlanes,
  type ServicioTorneos,
  type VerificadorCaptcha,
} from '@cancheria/servicios';
import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config.ts';
import { exigirCaptcha } from '../../plugins/captcha.ts';
import type { StreamsSse } from '../../plugins/eventos.ts';
import type { ServicioDisponibilidad } from './disponibilidad.service.ts';
import {
  cuerpoInscripcion,
  cuerpoListaEspera,
  cuerpoReserva,
  paramsCodigo,
  paramsInvitacion,
  paramsSlug,
  paramsTorneoPublico,
  queryDisponibilidad,
} from './esquemas.ts';
import type { ServicioReservas } from './reservas.service.ts';

interface Opciones {
  clubs: RepoClubs;
  disponibilidad: ServicioDisponibilidad;
  reservas: ServicioReservas;
  pagos: ServicioPagos;
  listaEspera: ServicioListaEspera;
  operacion: ServicioOperacion;
  sse: StreamsSse;
  torneos: ServicioTorneos;
  captcha: VerificadorCaptcha;
  planes: ServicioPlanes;
  config: Config;
}

export const rutasPublicas: FastifyPluginAsync<Opciones> = async (
  app,
  { clubs, disponibilidad, reservas, pagos, listaEspera, operacion, sse, torneos, captcha, planes, config },
) => {
  const clubPorSlug = async (params: unknown) => {
    const { slug } = paramsSlug.parse(params);
    const cfg = await clubs.porSlug(slug);
    if (!cfg) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe un club con ese link');
    return cfg;
  };
  /** Un club pendiente de aprobación o suspendido se ve pero no toma reservas. */
  const exigirHabilitado = (cfg: { club: { estado: string } }) => {
    if (cfg.club.estado !== 'ACTIVO') {
      throw new ErrorNegocio(
        403,
        'CLUB_NO_HABILITADO',
        'Este club todavía no toma reservas online. Escribile por WhatsApp para reservar.',
      );
    }
  };

  /** Precio y prueba gratis, para la página de venta (/clubes). */
  app.get('/plataforma', async () => ({
    planes: await planes.planes(),
    diasPrueba: config.diasPrueba,
  }));

  app.get('/clubs/:slug', async (req) => {
    const { club, canchas, mediosPago } = await clubPorSlug(req.params);
    return {
      slug: club.slug,
      nombre: club.nombre,
      direccion: club.direccion,
      telefono: club.telefono,
      logoUrl: club.logoUrl,
      zonaHoraria: club.zonaHoraria,
      /** PENDIENTE o SUSPENDIDO: la grilla se muestra, pero no se puede reservar. */
      habilitado: club.estado === 'ACTIVO',
      mediosPago,
      canchas: canchas.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        deporte: c.deporte,
        jugadoresPorLado: c.jugadoresPorLado,
        superficie: c.superficie,
        techada: c.techada,
        iluminacion: c.iluminacion,
        caracteristicas: c.caracteristicas,
        duracionMin: c.duracionTurnoMin,
      })),
    };
  });

  // --- Torneos -----------------------------------------------------------------

  app.get('/clubs/:slug/torneos', async (req) => {
    const { slug } = paramsSlug.parse(req.params);
    return torneos.listaPublica(slug);
  });

  app.get('/clubs/:slug/torneos/:torneo', async (req) => {
    const { slug, torneo } = paramsTorneoPublico.parse(req.params);
    return torneos.vistaPublica(slug, torneo);
  });

  app.post(
    '/clubs/:slug/torneos/:torneo/inscripcion',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, preHandler: exigirCaptcha(captcha) },
    async (req, reply) => {
      const { slug, torneo } = paramsTorneoPublico.parse(req.params);
      await torneos.inscribirOnline(slug, torneo, cuerpoInscripcion.parse(req.body));
      return reply.status(201).send({ estado: 'PENDIENTE' });
    },
  );

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
      exigirHabilitado(cfg);
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

  /** El partido para el grupo: lo que se comparte por WhatsApp desde el comprobante. */
  app.get('/partidos/:codigo', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) =>
    reservas.invitacion(paramsInvitacion.parse(req.params).codigo),
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

  /** El jugador cancela su reserva (dentro del plazo del club, con devolución de la seña). */
  app.post(
    '/reservas/:codigo/cancelar',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { codigo } = paramsCodigo.parse(req.params);
      const r = await operacion.cancelarPorCliente(codigo);
      return { ...(await reservas.porCodigo(codigo)), senaADevolver: r.senaADevolver };
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
    {
      config: { rateLimit: { max: config.reservasPorMinuto, timeWindow: '1 minute' } },
      preHandler: exigirCaptcha(captcha),
    },
    async (req, reply) => {
      const cfg = await clubPorSlug(req.params);
      exigirHabilitado(cfg);
      const p = cuerpoListaEspera.parse(req.body);
      disponibilidad.validarFecha(cfg, p.fecha);
      const zona = cfg.club.zonaHoraria;
      const fechaHasta = p.hasta <= p.desde ? sumarDias(p.fecha, 1) : p.fecha;
      const inscripcion = await listaEspera.inscribir(cfg, {
        cliente: p.cliente,
        desde: instanteLocal(p.fecha, p.desde, zona),
        hasta: instanteLocal(fechaHasta, p.hasta, zona),
        canchaId: p.canchaId,
        deporte: p.deporte,
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
