import type { Db } from '@cancheria/db';
import { clubs as tablaClubs } from '@cancheria/db/schema';
import {
  type AlmacenArchivos,
  type Cifrador,
  detectarTipoComprobante,
  ErrorMp,
  ErrorNegocio,
  guardarCredencialesMp,
  leerCredencialesMp,
  type PasarelaMp,
  type RepoClubs,
  type ServicioAuth,
  type ServicioCantina,
  type ServicioConfiguracion,
  type ServicioOperacion,
  type ServicioPagos,
  type ServicioReembolsos,
  type ServicioTurnosFijos,
} from '@cancheria/servicios';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config.ts';
import type { StreamsSse } from '../../plugins/eventos.ts';
import type { ConsultasAdmin } from './consultas.ts';
import {
  cuerpoAjuste,
  cuerpoBajaFijo,
  cuerpoBloqueo,
  cuerpoCancelar,
  cuerpoCancha,
  cuerpoCheckin,
  cuerpoClub,
  cuerpoContrasena,
  cuerpoDiaEspecial,
  cuerpoHorarios,
  cuerpoInvitar,
  cuerpoLogin,
  cuerpoMercadoPago,
  cuerpoModificarFijo,
  cuerpoPago,
  cuerpoPreviaFijo,
  cuerpoProducto,
  cuerpoProductoNuevo,
  cuerpoRechazo,
  cuerpoRegla,
  cuerpoReposicion,
  cuerpoRol,
  cuerpoTarifa,
  cuerpoTransferencia,
  cuerpoTurnoFijo,
  cuerpoTurnoManual,
  cuerpoVenta,
  paramsCancha,
  paramsFecha,
  paramsFijo,
  paramsOmitido,
  paramsPago,
  paramsProducto,
  paramsReembolso,
  paramsRegla,
  paramsTarifa,
  paramsTurno,
  paramsUsuario,
  paramsVenta,
  queryAgenda,
  queryProductos,
  queryReembolsos,
  queryResumenCantina,
  queryTransferencias,
  queryVentas,
} from './esquemas.ts';
import {
  COOKIE_SESION,
  clubIdDe,
  exigirCsrf,
  exigirRolEnClub,
  exigirSesion,
  setCookieSesion,
  usuarioDe,
} from './sesion.ts';

interface Opciones {
  db: Db;
  config: Config;
  auth: ServicioAuth;
  cantina: ServicioCantina;
  clubs: RepoClubs;
  consultas: ConsultasAdmin;
  configuracion: ServicioConfiguracion;
  operacion: ServicioOperacion;
  pagos: ServicioPagos;
  reembolsos: ServicioReembolsos;
  turnosFijos: ServicioTurnosFijos;
  pasarela: PasarelaMp;
  cifrador: Cifrador;
  almacen: AlmacenArchivos;
  sse: StreamsSse;
}

export const rutasAdmin: FastifyPluginAsync<Opciones> = async (app, o) => {
  app.addHook('onRequest', exigirCsrf);
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  // --- Sesión ----------------------------------------------------------------

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: o.config.loginsPorMinuto, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email, contrasena } = cuerpoLogin.parse(req.body);
      const r = await o.auth.login(email, contrasena, { ip: req.ip, userAgent: req.headers['user-agent'] });
      setCookieSesion(reply, r.token, r.expiraEn, o.config.cookiesSeguras);
      return { usuario: r.usuario, clubs: await o.auth.clubsDe(r.usuario.id) };
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    await o.auth.logout(req.cookies[COOKIE_SESION]);
    reply.clearCookie(COOKIE_SESION, { path: '/admin' });
    return reply.status(204).send();
  });

  app.get('/auth/yo', { preHandler: exigirSesion(o.auth) }, async (req) => {
    const u = usuarioDe(req);
    return { usuario: { id: u.id, email: u.email, nombre: u.nombre }, clubs: await o.auth.clubsDe(u.id) };
  });

  app.post('/auth/contrasena', { preHandler: exigirSesion(o.auth) }, async (req, reply) => {
    const { actual, nueva } = cuerpoContrasena.parse(req.body);
    const u = usuarioDe(req);
    await o.auth.cambiarContrasena(u.id, u.sesionId, actual, nueva);
    return reply.status(204).send();
  });

  // --- Todo lo del club: sesión + miembro del club + rol mínimo de la ruta -------

  await app.register(
    async (club) => {
      club.addHook('preHandler', exigirSesion(o.auth));
      club.addHook('preHandler', exigirRolEnClub(o.auth));
      const cfgDe = async (clubId: string) => {
        const cfg = await o.clubs.porId(clubId);
        if (!cfg) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
        return cfg;
      };

      club.get('/agenda', async (req) => {
        const q = queryAgenda.parse(req.query);
        return o.consultas.agenda(await cfgDe(clubIdDe(req)), q.fecha, q);
      });

      club.get('/eventos', async (req, reply) => {
        o.sse.abrir(req, reply, clubIdDe(req));
      });

      club.get('/turnos/:turnoId', async (req) => {
        const { clubId, turnoId } = paramsTurno.parse(req.params);
        const [turno, ventas] = await Promise.all([
          o.consultas.turno(clubId, turnoId),
          o.cantina.ventas(clubId, { turnoId }),
        ]);
        return { ...turno, ventas };
      });

      club.post('/turnos', async (req, reply) => {
        const p = cuerpoTurnoManual.parse(req.body);
        const turno = await o.operacion.crearManual(clubIdDe(req), usuarioDe(req).id, {
          ...p,
          inicio: new Date(p.inicio),
          fin: p.fin ? new Date(p.fin) : undefined,
        });
        return reply.status(201).send(await o.consultas.turno(turno.clubId, turno.id));
      });

      club.post('/bloqueos', async (req, reply) => {
        const p = cuerpoBloqueo.parse(req.body);
        const turno = await o.operacion.bloquear(clubIdDe(req), usuarioDe(req).id, {
          ...p,
          inicio: new Date(p.inicio),
          fin: new Date(p.fin),
        });
        return reply.status(201).send(await o.consultas.turno(turno.clubId, turno.id));
      });

      club.post('/turnos/:turnoId/cancelar', async (req) => {
        const { clubId, turnoId } = paramsTurno.parse(req.params);
        return o.operacion.cancelar(clubId, usuarioDe(req).id, turnoId, cuerpoCancelar.parse(req.body));
      });

      club.post('/turnos/:turnoId/ausente', async (req) => {
        const { clubId, turnoId } = paramsTurno.parse(req.params);
        return o.operacion.marcarAusente(clubId, usuarioDe(req).id, turnoId);
      });

      club.post('/turnos/:turnoId/pagos', async (req, reply) => {
        const { clubId, turnoId } = paramsTurno.parse(req.params);
        const r = await o.operacion.registrarPago(
          clubId,
          usuarioDe(req).id,
          turnoId,
          cuerpoPago.parse(req.body),
        );
        return reply.status(201).send(r);
      });

      club.post('/checkin', async (req) => {
        const { qr, forzar } = cuerpoCheckin.parse(req.body);
        return o.operacion.checkin(clubIdDe(req), usuarioDe(req).id, qr, { forzar: forzar ?? false });
      });

      // --- Cantina ----------------------------------------------------------------

      club.get('/cantina/productos', async (req) => {
        const { inactivos } = queryProductos.parse(req.query);
        return o.cantina.productos(clubIdDe(req), { incluirInactivos: inactivos ?? false });
      });

      club.post('/cantina/productos', { config: { rolMinimo: 'ADMIN' } }, async (req, reply) =>
        reply
          .status(201)
          .send(
            await o.cantina.crearProducto(
              clubIdDe(req),
              usuarioDe(req).id,
              cuerpoProductoNuevo.parse(req.body),
            ),
          ),
      );

      club.patch('/cantina/productos/:productoId', { config: { rolMinimo: 'ADMIN' } }, async (req, reply) => {
        const { clubId, productoId } = paramsProducto.parse(req.params);
        await o.cantina.actualizarProducto(clubId, productoId, cuerpoProducto.partial().parse(req.body));
        return reply.status(204).send();
      });

      club.post('/cantina/productos/:productoId/reposicion', async (req) => {
        const { clubId, productoId } = paramsProducto.parse(req.params);
        const { cantidad, motivo } = cuerpoReposicion.parse(req.body);
        return o.cantina.reponer(clubId, usuarioDe(req).id, productoId, cantidad, motivo);
      });

      club.post('/cantina/productos/:productoId/ajuste', { config: { rolMinimo: 'ADMIN' } }, async (req) => {
        const { clubId, productoId } = paramsProducto.parse(req.params);
        const { stock, motivo } = cuerpoAjuste.parse(req.body);
        return o.cantina.ajustar(clubId, usuarioDe(req).id, productoId, stock, motivo);
      });

      club.get(
        '/cantina/productos/:productoId/movimientos',
        { config: { rolMinimo: 'ADMIN' } },
        async (req) => {
          const { clubId, productoId } = paramsProducto.parse(req.params);
          return o.cantina.movimientos(clubId, productoId);
        },
      );

      club.post('/cantina/ventas', async (req, reply) =>
        reply
          .status(201)
          .send(await o.cantina.vender(clubIdDe(req), usuarioDe(req).id, cuerpoVenta.parse(req.body))),
      );

      club.get('/cantina/ventas', async (req) => {
        const q = queryVentas.parse(req.query);
        if (!q.fecha && !q.turnoId) throw new ErrorNegocio(422, 'FILTRO_REQUERIDO', 'Indicá fecha o turno');
        return o.cantina.ventas(clubIdDe(req), {
          ...(q.fecha ? { fecha: q.fecha } : {}),
          ...(q.turnoId ? { turnoId: q.turnoId } : {}),
        });
      });

      club.post('/cantina/ventas/:ventaId/anular', async (req, reply) => {
        const { clubId, ventaId } = paramsVenta.parse(req.params);
        await o.cantina.anular(clubId, usuarioDe(req).id, ventaId, cuerpoRechazo.parse(req.body).motivo);
        return reply.status(204).send();
      });

      club.get('/cantina/resumen', async (req) =>
        o.cantina.resumenDia(clubIdDe(req), queryResumenCantina.parse(req.query).fecha),
      );

      // --- Turnos fijos -----------------------------------------------------------

      club.get('/turnos-fijos', async (req) => o.turnosFijos.listar(clubIdDe(req)));

      club.get('/turnos-fijos/pendientes', async (req) => ({
        omitidos: await o.turnosFijos.pendientes(clubIdDe(req)),
      }));

      club.post('/turnos-fijos/previsualizar', async (req) =>
        o.turnosFijos.previsualizar(clubIdDe(req), cuerpoPreviaFijo.parse(req.body)),
      );

      club.post('/turnos-fijos', async (req, reply) =>
        reply
          .status(201)
          .send(await o.turnosFijos.crear(clubIdDe(req), usuarioDe(req).id, cuerpoTurnoFijo.parse(req.body))),
      );

      club.patch('/turnos-fijos/:fijoId', async (req) => {
        const { clubId, fijoId } = paramsFijo.parse(req.params);
        return o.turnosFijos.modificar(
          clubId,
          usuarioDe(req).id,
          fijoId,
          cuerpoModificarFijo.parse(req.body),
        );
      });

      club.post('/turnos-fijos/:fijoId/baja', async (req) => {
        const { clubId, fijoId } = paramsFijo.parse(req.params);
        return o.turnosFijos.darDeBaja(clubId, usuarioDe(req).id, fijoId, cuerpoBajaFijo.parse(req.body));
      });

      club.post('/turnos-fijos/:fijoId/omitidos/:fecha/reintentar', async (req) => {
        const { clubId, fijoId, fecha } = paramsOmitido.parse(req.params);
        return o.turnosFijos.reintentar(clubId, usuarioDe(req).id, fijoId, fecha);
      });

      club.delete('/turnos-fijos/:fijoId/omitidos/:fecha', async (req, reply) => {
        const { clubId, fijoId, fecha } = paramsOmitido.parse(req.params);
        await o.turnosFijos.descartarOmitido(clubId, fijoId, fecha);
        return reply.status(204).send();
      });

      // --- Transferencias y reembolsos -------------------------------------------

      club.get('/transferencias', async (req) => {
        const { estado } = queryTransferencias.parse(req.query);
        return o.consultas.transferencias(clubIdDe(req), estado);
      });

      club.get('/pagos/:pagoId/comprobante', async (req, reply) => {
        const { clubId, pagoId } = paramsPago.parse(req.params);
        const datos = await o.almacen.leer(await o.consultas.comprobante(clubId, pagoId));
        if (!datos) throw new ErrorNegocio(404, 'COMPROBANTE_NO_ENCONTRADO', 'No se encontró el archivo');
        const tipo = detectarTipoComprobante(datos);
        return reply
          .header('content-type', tipo?.mime ?? 'application/octet-stream')
          .header('content-disposition', `inline; filename="comprobante.${tipo?.extension ?? 'bin'}"`)
          .header('x-content-type-options', 'nosniff')
          .send(datos);
      });

      club.post('/pagos/:pagoId/aprobar', async (req) => {
        const { clubId, pagoId } = paramsPago.parse(req.params);
        return o.pagos.aprobarTransferencia(clubId, pagoId, usuarioDe(req).id);
      });

      club.post('/pagos/:pagoId/rechazar', async (req) => {
        const { clubId, pagoId } = paramsPago.parse(req.params);
        await o.pagos.rechazarTransferencia(
          clubId,
          pagoId,
          usuarioDe(req).id,
          cuerpoRechazo.parse(req.body).motivo,
        );
        return { ok: true };
      });

      club.get('/reembolsos', async (req) => {
        const { estado } = queryReembolsos.parse(req.query);
        return o.consultas.reembolsos(clubIdDe(req), estado);
      });

      club.post('/reembolsos/:reembolsoId/hecho', { config: { rolMinimo: 'ADMIN' } }, async (req) => {
        const { clubId, reembolsoId } = paramsReembolso.parse(req.params);
        await o.reembolsos.marcarHechoManual(clubId, reembolsoId, usuarioDe(req).id);
        return { ok: true };
      });

      // --- Medios de cobro del club ----------------------------------------------

      club.get('/mercadopago', { config: { rolMinimo: 'ADMIN' } }, async (req) => {
        const cfg = await cfgDe(clubIdDe(req));
        const cred = await leerCredencialesMp(o.db, o.cifrador, cfg.club.id);
        return {
          configurado: Boolean(cred),
          // El token nunca sale del servidor; solo se muestra que existe.
          conWebhookSecret: Boolean(cred?.webhookSecret),
          urlWebhook: `${o.config.urlApi.replace(/\/$/, '')}/webhooks/mercadopago/${cfg.club.slug}`,
        };
      });

      club.put('/mercadopago', { config: { rolMinimo: 'OWNER' } }, async (req) => {
        const clubId = clubIdDe(req);
        const p = cuerpoMercadoPago.parse(req.body);
        let cuenta: { id: string; nickname: string };
        try {
          cuenta = await o.pasarela.verificarCredenciales(p.accessToken);
        } catch (err) {
          if (err instanceof ErrorMp && err.status < 500) {
            throw new ErrorNegocio(422, 'CREDENCIALES_MP_INVALIDAS', 'Mercado Pago rechazó ese access token');
          }
          throw new ErrorNegocio(
            502,
            'MP_SIN_RESPUESTA',
            'No se pudo validar con Mercado Pago, probá de nuevo',
            undefined,
            err,
          );
        }
        await guardarCredencialesMp(o.db, o.cifrador, clubId, {
          accessToken: p.accessToken,
          ...(p.webhookSecret ? { webhookSecret: p.webhookSecret } : {}),
        });
        o.clubs.invalidar();
        return { configurado: true, cuenta };
      });

      club.delete('/mercadopago', { config: { rolMinimo: 'OWNER' } }, async (req, reply) => {
        await o.db
          .update(tablaClubs)
          .set({ mpCredencialesCifradas: null })
          .where(eq(tablaClubs.id, clubIdDe(req)));
        o.clubs.invalidar();
        return reply.status(204).send();
      });

      club.put('/transferencia', { config: { rolMinimo: 'ADMIN' } }, async (req) => {
        const { alias, cbu, titular } = cuerpoTransferencia.parse(req.body);
        const datos = { titular, ...(alias ? { alias } : {}), ...(cbu ? { cbu } : {}) };
        await o.db
          .update(tablaClubs)
          .set({ datosTransferencia: datos })
          .where(eq(tablaClubs.id, clubIdDe(req)));
        o.clubs.invalidar();
        return datos;
      });

      club.delete('/transferencia', { config: { rolMinimo: 'ADMIN' } }, async (req, reply) => {
        await o.db
          .update(tablaClubs)
          .set({ datosTransferencia: null })
          .where(eq(tablaClubs.id, clubIdDe(req)));
        o.clubs.invalidar();
        return reply.status(204).send();
      });

      // --- Configuración del club --------------------------------------------------

      const admin = { config: { rolMinimo: 'ADMIN' as const } };
      const owner = { config: { rolMinimo: 'OWNER' as const } };
      const c = o.configuracion;

      club.get('/config', admin, async (req) => c.leer(clubIdDe(req)));

      club.patch('/config/club', admin, async (req, reply) => {
        await c.actualizarClub(clubIdDe(req), cuerpoClub.parse(req.body));
        return reply.status(204).send();
      });

      club.post('/config/canchas', admin, async (req, reply) =>
        reply.status(201).send(await c.crearCancha(clubIdDe(req), cuerpoCancha.parse(req.body))),
      );

      club.patch('/config/canchas/:canchaId', admin, async (req, reply) => {
        const { clubId, canchaId } = paramsCancha.parse(req.params);
        await c.actualizarCancha(clubId, canchaId, cuerpoCancha.partial().parse(req.body));
        return reply.status(204).send();
      });

      club.post('/config/tarifas', admin, async (req, reply) =>
        reply.status(201).send(await c.crearTarifa(clubIdDe(req), cuerpoTarifa.parse(req.body))),
      );

      club.put('/config/tarifas/:tarifaId', admin, async (req, reply) => {
        const { clubId, tarifaId } = paramsTarifa.parse(req.params);
        await c.actualizarTarifa(clubId, tarifaId, cuerpoTarifa.parse(req.body));
        return reply.status(204).send();
      });

      club.delete('/config/tarifas/:tarifaId', admin, async (req, reply) => {
        const { clubId, tarifaId } = paramsTarifa.parse(req.params);
        await c.borrarTarifa(clubId, tarifaId);
        return reply.status(204).send();
      });

      club.put('/config/horarios', admin, async (req, reply) => {
        await c.reemplazarHorarios(clubIdDe(req), cuerpoHorarios.parse(req.body));
        return reply.status(204).send();
      });

      club.put('/config/dias-especiales/:fecha', admin, async (req, reply) => {
        const { clubId, fecha } = paramsFecha.parse(req.params);
        await c.guardarDiaEspecial(clubId, fecha, cuerpoDiaEspecial.parse(req.body));
        return reply.status(204).send();
      });

      club.delete('/config/dias-especiales/:fecha', admin, async (req, reply) => {
        const { clubId, fecha } = paramsFecha.parse(req.params);
        await c.borrarDiaEspecial(clubId, fecha);
        return reply.status(204).send();
      });

      club.post('/config/reglas', admin, async (req, reply) =>
        reply.status(201).send(await c.crearRegla(clubIdDe(req), cuerpoRegla.parse(req.body))),
      );

      club.put('/config/reglas/:reglaId', admin, async (req, reply) => {
        const { clubId, reglaId } = paramsRegla.parse(req.params);
        await c.actualizarRegla(clubId, reglaId, cuerpoRegla.parse(req.body));
        return reply.status(204).send();
      });

      club.delete('/config/reglas/:reglaId', admin, async (req, reply) => {
        const { clubId, reglaId } = paramsRegla.parse(req.params);
        await c.borrarRegla(clubId, reglaId);
        return reply.status(204).send();
      });

      club.get('/config/usuarios', owner, async (req) => c.usuarios(clubIdDe(req)));

      club.post('/config/usuarios', owner, async (req, reply) =>
        reply.status(201).send(await c.invitar(clubIdDe(req), cuerpoInvitar.parse(req.body))),
      );

      club.patch('/config/usuarios/:usuarioId', owner, async (req, reply) => {
        const { clubId, usuarioId } = paramsUsuario.parse(req.params);
        await c.cambiarRol(clubId, usuarioId, cuerpoRol.parse(req.body).rol);
        return reply.status(204).send();
      });

      club.delete('/config/usuarios/:usuarioId', owner, async (req, reply) => {
        const { clubId, usuarioId } = paramsUsuario.parse(req.params);
        await c.quitar(clubId, usuarioId);
        return reply.status(204).send();
      });
    },
    { prefix: '/clubs/:clubId' },
  );
};
