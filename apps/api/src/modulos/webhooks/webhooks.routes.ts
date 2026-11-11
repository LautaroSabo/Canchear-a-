import type { Db } from '@cancheria/db';
import {
  type Cifrador,
  ErrorNegocio,
  firmaWebhookValida,
  leerCredencialesMp,
  type RepoClubs,
  type ServicioAbono,
  type ServicioPagos,
} from '@cancheria/servicios';
import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../../config.ts';
import { paramsSlug } from '../publico/esquemas.ts';

interface Opciones {
  abono: ServicioAbono;
  config: Config;
  clubs: RepoClubs;
  pagos: ServicioPagos;
  db: Db;
  cifrador: Cifrador;
}

const cabecera = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export const rutasWebhooks: FastifyPluginAsync<Opciones> = async (
  app,
  { clubs, pagos, db, cifrador, abono, config },
) => {
  /**
   * Notificaciones de Mercado Pago. Cada club tiene su propia cuenta de MP, por eso la
   * URL lleva el slug. Se responde 2xx rápido; si algo falla se responde 500 y MP reintenta.
   * El cuerpo solo se usa para saber qué pago consultar: el estado real se le pide a MP.
   */
  app.post(
    '/mercadopago/:slug',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { slug } = paramsSlug.parse(req.params);
      const cfg = await clubs.porSlug(slug);
      if (!cfg) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');

      const query = req.query as Record<string, string | undefined>;
      const cuerpo = (req.body ?? {}) as { type?: string; data?: { id?: string | number } };
      const tipo = query.type ?? query.topic ?? cuerpo.type;
      const idQuery = query['data.id'] ?? query.id;
      const pagoId = idQuery ?? (cuerpo.data?.id !== undefined ? String(cuerpo.data.id) : undefined);
      if (tipo !== 'payment' || !pagoId) return reply.status(200).send({ ignorado: true });

      const cred = await leerCredencialesMp(db, cifrador, cfg.club.id);
      if (!cred) throw new ErrorNegocio(404, 'MP_NO_CONFIGURADO', 'El club no tiene Mercado Pago');
      if (
        cred.webhookSecret &&
        !firmaWebhookValida({
          secreto: cred.webhookSecret,
          firma: cabecera(req.headers['x-signature']),
          requestId: cabecera(req.headers['x-request-id']),
          dataId: idQuery,
        })
      ) {
        req.log.warn({ slug, pagoId }, 'webhook de MP con firma inválida');
        throw new ErrorNegocio(401, 'FIRMA_INVALIDA', 'Firma inválida');
      }

      const resultado = await pagos.procesarNotificacionMp(cfg.club.id, pagoId);
      req.log.info({ slug, pagoId, resultado }, 'webhook de Mercado Pago procesado');
      return { ok: true, resultado: resultado.tipo };
    },
  );

  /**
   * Avisos de la cuenta de Mercado Pago de la plataforma: suscripciones del abono
   * (subscription_preapproval) y sus cobros mensuales (subscription_authorized_payment).
   * Se configura en la app de MP de la plataforma (ver docs/abono.md).
   */
  app.post(
    '/mercadopago-abono',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const query = req.query as Record<string, string | undefined>;
      const cuerpo = (req.body ?? {}) as { type?: string; data?: { id?: string | number } };
      const tipo = query.type ?? query.topic ?? cuerpo.type;
      const idQuery = query['data.id'] ?? query.id;
      const id = idQuery ?? (cuerpo.data?.id !== undefined ? String(cuerpo.data.id) : undefined);
      if (!tipo || !id) return reply.status(200).send({ ignorado: true });
      const secreto = config.mpAbono.webhookSecret;
      if (
        secreto &&
        !firmaWebhookValida({
          secreto,
          firma: cabecera(req.headers['x-signature']),
          requestId: cabecera(req.headers['x-request-id']),
          dataId: idQuery,
        })
      ) {
        req.log.warn({ tipo, id }, 'webhook del abono con firma inválida');
        throw new ErrorNegocio(401, 'FIRMA_INVALIDA', 'Firma inválida');
      }
      const resultado = await abono.procesarNotificacion(tipo, id);
      req.log.info({ tipo, id, resultado }, 'webhook del abono procesado');
      return { ok: true, resultado: resultado.tipo };
    },
  );
};
