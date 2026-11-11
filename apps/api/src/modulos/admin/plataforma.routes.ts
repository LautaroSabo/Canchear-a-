import {
  type Correo,
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
  correo: Correo | null;
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
  aceptaTerminos: z.literal(true, { error: 'Tenés que aceptar los Términos y la Política de privacidad' }),
});

const cuerpoOlvide = z.object({ email: z.email().max(120) });
const cuerpoRestablecer = z.object({ token: z.string().min(20).max(200), nueva: z.string().min(1).max(200) });

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
  return {
    abonoMensual: config.abonoMensual,
    comoPagarAbono: config.comoPagarAbono,
    diasPrueba: config.diasPrueba,
  };
}

/** Link para elegir una contraseña nueva (página de la web). */
const linkRestablecer = (o: Opciones, token: string) =>
  `${o.config.urlWeb.replace(/\/$/, '')}/panel/restablecer?token=${encodeURIComponent(token)}`;

/** Mail a la plataforma cuando un club se registra solo. */
async function avisarRegistro(o: Opciones, d: z.infer<typeof cuerpoRegistro>) {
  if (!o.correo || !o.config.avisosEmail) return;
  const web = o.config.urlWeb.replace(/\/$/, '');
  await o.correo.enviar({
    para: o.config.avisosEmail,
    asunto: `Nuevo club para aprobar: ${d.club.nombre}`,
    texto: [
      'Se registró un club nuevo y espera tu aprobación.',
      '',
      `Club: ${d.club.nombre}`,
      `Página: ${web}/${d.club.slug.trim().toLowerCase()}`,
      `WhatsApp: ${d.club.telefono}`,
      ...(d.club.direccion ? [`Dirección: ${d.club.direccion}`] : []),
      '',
      `Dueño: ${d.dueno.nombre}`,
      `Email: ${d.dueno.email}`,
      '',
      `Aprobalo en ${web}/panel/plataforma`,
    ].join('\n'),
  });
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
    setCookieSesion(reply, r.token, r.expiraEn, o.config);
    req.log.info({ clubId, slug: datos.club.slug }, 'club nuevo registrado: espera aprobación');
    // El aviso sale en segundo plano: si el mail falla, el alta igual queda (y se ve en el panel).
    avisarRegistro(o, datos).catch((err) =>
      req.log.error({ err, clubId }, 'no se pudo mandar el aviso de registro'),
    );
    return reply.status(201).send({ clubId, usuario: r.usuario, clubs: await o.auth.clubsDe(r.usuario.id) });
  });

  /**
   * "Olvidé mi contraseña": si el email tiene cuenta, le manda el link por mail. Responde
   * siempre lo mismo, exista o no la cuenta, para no revelar qué emails están registrados.
   */
  app.post(
    '/auth/olvide',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email } = cuerpoOlvide.parse(req.body);
      const r = await o.auth.crearRestablecimiento(email);
      if (r && o.correo) {
        o.correo
          .enviar({
            para: r.email,
            asunto: 'Elegí una contraseña nueva para Canchería',
            texto: [
              `Hola ${r.nombre}:`,
              '',
              'Pediste una contraseña nueva para entrar al panel de Canchería. Elegila desde este link:',
              '',
              linkRestablecer(o, r.token),
              '',
              'El link sirve una sola vez y vence en 1 hora. Si no lo pediste vos, ignorá este mail: tu contraseña no cambia.',
            ].join('\n'),
          })
          .catch((err) => req.log.error({ err }, 'no se pudo mandar el mail de contraseña nueva'));
      } else if (r) {
        req.log.warn('pidieron una contraseña nueva pero no hay correo configurado');
      }
      return reply.status(204).send();
    },
  );

  app.post(
    '/auth/restablecer',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token, nueva } = cuerpoRestablecer.parse(req.body);
      await o.auth.restablecer(token, nueva);
      return reply.status(204).send();
    },
  );

  await app.register(async (sa) => {
    sa.addHook('preHandler', exigirSesion(o.auth));
    sa.addHook('preHandler', exigirSuperadmin);

    /** Link de contraseña nueva para mandárselo a alguien por WhatsApp (sin depender del mail). */
    sa.post('/plataforma/restablecer', async (req) => {
      const { email } = cuerpoOlvide.parse(req.body);
      const r = await o.auth.crearRestablecimiento(email);
      if (!r)
        throw new ErrorNegocio(404, 'USUARIO_NO_ENCONTRADO', 'No hay ningún usuario activo con ese email');
      return { email: r.email, nombre: r.nombre, link: linkRestablecer(o, r.token), venceEnMinutos: 60 };
    });

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
