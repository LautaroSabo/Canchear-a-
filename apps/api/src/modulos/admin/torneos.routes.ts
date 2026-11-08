import type { ServicioTorneos } from '@cancheria/servicios';
import type { FastifyInstance } from 'fastify';
import {
  cuerpoEquipo,
  cuerpoEstadoEquipo,
  cuerpoIniciarTorneo,
  cuerpoMoverPartido,
  cuerpoResultado,
  cuerpoTorneo,
  paramsEquipo,
  paramsPartido,
  paramsTorneo,
} from './esquemas.ts';
import { clubIdDe, usuarioDe } from './sesion.ts';

/**
 * Torneos y ligas, dentro del scope `/clubs/:clubId` (sesión y membresía ya validadas).
 * Armar y configurar es de ADMIN; cargar resultados lo puede hacer la recepción.
 */
export function rutasTorneos(club: FastifyInstance, torneos: ServicioTorneos) {
  const admin = { config: { rolMinimo: 'ADMIN' as const } };

  club.get('/torneos', async (req) => torneos.listar(clubIdDe(req)));

  club.post('/torneos', admin, async (req, reply) =>
    reply.status(201).send(await torneos.crear(clubIdDe(req), cuerpoTorneo.parse(req.body))),
  );

  club.get('/torneos/:torneoId', async (req) => {
    const { clubId, torneoId } = paramsTorneo.parse(req.params);
    return torneos.vistaPanel(clubId, torneoId);
  });

  club.put('/torneos/:torneoId', admin, async (req, reply) => {
    const { clubId, torneoId } = paramsTorneo.parse(req.params);
    await torneos.actualizar(clubId, torneoId, cuerpoTorneo.parse(req.body));
    return reply.status(204).send();
  });

  club.delete('/torneos/:torneoId', admin, async (req, reply) => {
    const { clubId, torneoId } = paramsTorneo.parse(req.params);
    await torneos.eliminar(clubId, torneoId);
    return reply.status(204).send();
  });

  club.post('/torneos/:torneoId/equipos', admin, async (req, reply) => {
    const { clubId, torneoId } = paramsTorneo.parse(req.params);
    return reply
      .status(201)
      .send(await torneos.agregarEquipo(clubId, torneoId, cuerpoEquipo.parse(req.body)));
  });

  club.patch('/torneos/:torneoId/equipos/:equipoId', admin, async (req, reply) => {
    const { clubId, torneoId, equipoId } = paramsEquipo.parse(req.params);
    await torneos.cambiarEstadoEquipo(clubId, torneoId, equipoId, cuerpoEstadoEquipo.parse(req.body).estado);
    return reply.status(204).send();
  });

  club.delete('/torneos/:torneoId/equipos/:equipoId', admin, async (req, reply) => {
    const { clubId, torneoId, equipoId } = paramsEquipo.parse(req.params);
    await torneos.quitarEquipo(clubId, torneoId, equipoId);
    return reply.status(204).send();
  });

  club.post('/torneos/:torneoId/iniciar', admin, async (req) => {
    const { clubId, torneoId } = paramsTorneo.parse(req.params);
    const { sortear } = cuerpoIniciarTorneo.parse(req.body ?? {});
    await torneos.iniciar(clubId, torneoId, usuarioDe(req).id, { sortear: sortear ?? true });
    return torneos.vistaPanel(clubId, torneoId);
  });

  club.post('/torneos/:torneoId/eliminacion', admin, async (req) => {
    const { clubId, torneoId } = paramsTorneo.parse(req.params);
    await torneos.armarEliminacion(clubId, torneoId, usuarioDe(req).id);
    return torneos.vistaPanel(clubId, torneoId);
  });

  club.post('/torneos/:torneoId/finalizar', admin, async (req, reply) => {
    const { clubId, torneoId } = paramsTorneo.parse(req.params);
    await torneos.finalizar(clubId, torneoId);
    return reply.status(204).send();
  });

  club.put('/torneos/:torneoId/partidos/:partidoId/resultado', async (req) => {
    const { clubId, torneoId, partidoId } = paramsPartido.parse(req.params);
    await torneos.cargarResultado(clubId, torneoId, partidoId, cuerpoResultado.parse(req.body));
    return torneos.vistaPanel(clubId, torneoId);
  });

  club.post('/torneos/:torneoId/partidos/:partidoId/mover', admin, async (req) => {
    const { clubId, torneoId, partidoId } = paramsPartido.parse(req.params);
    const p = cuerpoMoverPartido.parse(req.body);
    await torneos.moverPartido(
      clubId,
      torneoId,
      partidoId,
      { inicio: new Date(p.inicio), canchaId: p.canchaId },
      usuarioDe(req).id,
    );
    return torneos.vistaPanel(clubId, torneoId);
  });
}
