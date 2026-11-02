import {
  ErrorNegocio,
  type RepoClubs,
  type ServicioAuth,
  type ServicioPlataforma,
} from '@cancheria/servicios';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.ts';
import { exigirSesion, setCookieSesion, usuarioDe } from './sesion.ts';

interface Opciones {
  config: Config;
  auth: ServicioAuth;
  clubs: RepoClubs;
  plataforma: ServicioPlataforma;
}

const cuerpoRegistro = z.object({
  club: z.object({
    nombre: z.string().trim().min(2).max(80),
    slug: z.string().trim().min(1).max(40),
    telefono: z.string().trim().min(6).max(30),
    direccion: z.string().trim().max(160).optional(),
  }),
  dueno: z.object({
    nombre: z.string().trim().min(2).max(80),
    email: z.email().max(120),
    contrasena: z.string().min(1).max(200),
  }),
});

const querySlug = z.object({ slug: z.string().trim().toLowerCase().max(60) });
const paramsClubPlataforma = z.object({ id: z.uuid() });
const cuerpoAprobar = z.object({ diasPrueba: z.number().int().min(0).max(120).default(0) });
const cuerpoSuspender = z.object({ motivo: z.string().trim().min(3).max(300) });
const cuerpoPagoAbono = z.object({
  meses: z.number().int().min(1).max(24),
  monto: z.number().int().min(0).max(100_000_000),
  medio: z.enum(['TRANSFERENCIA', 'MERCADO_PAGO', 'EFECTIVO', 'OTRO']),
  nota: z.string().trim().max(300).optional(),
});

async function exigirSuperadmin(req: FastifyRequest) {
  // Para quien no es superadmin, estas rutas no existen.
  if (!usuarioDe(req).esSuperadmin) throw new ErrorNegocio(404, 'NO_ENCONTRADO', 'No encontrado');
}

/** Datos del abono que ve cada club en su panel (configurados en el servidor). */
export function abonoPublico(config: Config) {
  return { abonoMensual: config.abonoMensual, comoPagarAbono: config.comoPagarAbono };
}

/** Registro de clubes nuevos (público) y administración de la plataforma (superadmin). */
export async function rutasPlataforma(app: FastifyInstance, o: Opciones) {
  app.get('/registro/slug', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) =>
    o.plataforma.slugDisponible(querySlug.parse(req.query).slug),
  );

  /** Alta de un club: queda pendiente de aprobación y el dueño entra directo al panel. */
  app.post('/registro', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const datos = cuerpoRegistro.parse(req.body);
    const { clubId } = await o.plataforma.registrar(datos);
    const r = await o.auth.login(datos.dueno.email, datos.dueno.contrasena, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setCookieSesion(reply, r.token, r.expiraEn, o.config.cookiesSeguras);
    req.log.info({ clubId, slug: datos.club.slug }, 'club nuevo registrado: espera aprobación');
    return reply.status(201).send({ clubId, usuario: r.usuario, clubs: await o.auth.clubsDe(r.usuario.id) });
  });

  await app.register(async (sa) => {
    sa.addHook('preHandler', exigirSesion(o.auth));
    sa.addHook('preHandler', exigirSuperadmin);

    sa.get('/plataforma/clubs', async () => ({
      hoy: o.plataforma.hoy(),
      clubs: await o.plataforma.listar(),
    }));

    sa.post('/plataforma/clubs/:id/aprobar', async (req, reply) => {
      const { id } = paramsClubPlataforma.parse(req.params);
      await o.plataforma.aprobar(id, cuerpoAprobar.parse(req.body ?? {}).diasPrueba);
      o.clubs.invalidar();
      return reply.status(204).send();
    });

    sa.post('/plataforma/clubs/:id/suspender', async (req, reply) => {
      const { id } = paramsClubPlataforma.parse(req.params);
      await o.plataforma.suspender(id, cuerpoSuspender.parse(req.body).motivo);
      o.clubs.invalidar();
      return reply.status(204).send();
    });

    sa.post('/plataforma/clubs/:id/reactivar', async (req, reply) => {
      const { id } = paramsClubPlataforma.parse(req.params);
      await o.plataforma.reactivar(id);
      o.clubs.invalidar();
      return reply.status(204).send();
    });

    sa.get('/plataforma/clubs/:id/pagos', async (req) =>
      o.plataforma.pagos(paramsClubPlataforma.parse(req.params).id),
    );

    sa.post('/plataforma/clubs/:id/pagos', async (req, reply) => {
      const { id } = paramsClubPlataforma.parse(req.params);
      const pago = await o.plataforma.registrarPago(id, usuarioDe(req).id, cuerpoPagoAbono.parse(req.body));
      return reply.status(201).send(pago);
    });
  });
}
