import { firmarWebhook } from '@cancheria/servicios/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Contexto, crearContexto, panel, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
let dueno: string;
let admin: string;
const SECRETO = 'secreto-abono';
beforeAll(async () => {
  ctx = await crearContexto({
    abonoMensual: 2_500_000,
    mpAbono: { token: 'TOKEN-PLATAFORMA', webhookSecret: SECRETO },
  });
  dueno = (await usuarioPanel(ctx, 'OWNER')).cookie;
  admin = (await usuarioPanel(ctx, 'ADMIN')).cookie;
});
afterAll(() => ctx.cerrar());

const webhook = (tipo: string, id: string, firma = true) => {
  const requestId = `req-${id}`;
  return ctx.app.inject({
    method: 'POST',
    url: `/webhooks/mercadopago-abono?type=${tipo}&data.id=${id}`,
    headers: {
      'x-request-id': requestId,
      ...(firma ? { 'x-signature': firmarWebhook(SECRETO, id, requestId) } : {}),
    },
    payload: { type: tipo, data: { id } },
  });
};

describe('abono con pago automático', () => {
  it('el dueño lo activa, Mercado Pago avisa y el abono se extiende', async () => {
    expect((await panel(ctx, admin, 'GET', '/abono')).statusCode).toBe(403);
    const estado = (await panel(ctx, dueno, 'GET', '/abono')).json();
    expect(estado).toMatchObject({
      abonoMensual: 3_990_000,
      precio: { plan: { nombre: 'Chico' }, canchas: 3 },
      cobroAutomatico: true,
      suscripcion: null,
    });

    const r = await panel(ctx, dueno, 'POST', '/abono/suscripcion', { email: 'duenio@club.test' });
    expect(r.statusCode).toBe(200);
    expect(r.json().urlCheckout).toMatch(/^https:\/\/mp\.test\/suscripcion\//);
    const [s] = [...ctx.pasarelaSuscripciones.suscripciones.values()];

    // Firma inválida: 401.
    expect((await webhook('subscription_preapproval', s!.id, false)).statusCode).toBe(401);
    ctx.pasarelaSuscripciones.autorizar(s!.id);
    expect((await webhook('subscription_preapproval', s!.id)).json()).toMatchObject({
      resultado: 'SUSCRIPCION',
    });
    expect((await panel(ctx, dueno, 'GET', '/abono')).json().suscripcion).toEqual({
      estado: 'authorized',
      email: 'duenio@club.test',
    });

    const cobro = ctx.pasarelaSuscripciones.cobrar(s!.id);
    expect((await webhook('subscription_authorized_payment', cobro)).json()).toMatchObject({
      resultado: 'ABONO_PAGADO',
    });
    expect((await panel(ctx, dueno, 'GET', '/abono')).json().abonoHasta).toBe('2030-02-03');

    expect((await panel(ctx, dueno, 'DELETE', '/abono/suscripcion')).statusCode).toBe(204);
    expect((await panel(ctx, dueno, 'GET', '/abono')).json().suscripcion.estado).toBe('cancelled');
  });

  it('avisos de otros tipos se ignoran', async () => {
    expect((await webhook('payment', '123')).json()).toMatchObject({ resultado: 'IGNORADO' });
  });
});
