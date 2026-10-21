import { notificaciones } from '@cancheria/db/schema';
import { firmarWebhook } from '@cancheria/servicios/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AHORA, type Contexto, crearContexto, iso, multipart, PNG, pedido, reservar } from './helpers.ts';

let ctx: Contexto;
beforeAll(async () => {
  ctx = await crearContexto();
});
afterEach(() => ctx.setAhora(AHORA));
afterAll(() => ctx.cerrar());

const reservaCon = async (hora: string, cancha = ctx.canchas.f5a) =>
  (await reservar(ctx, pedido(cancha.id, iso('2030-01-05', hora)))).json() as {
    codigo: string;
    estado: string;
  };

const webhook = (pagoId: string, { firma = true, requestId = 'req-123' } = {}) =>
  ctx.app.inject({
    method: 'POST',
    url: `/webhooks/mercadopago/${ctx.slug}?data.id=${pagoId}&type=payment`,
    headers: {
      'x-request-id': requestId,
      ...(firma ? { 'x-signature': firmarWebhook('secreto-webhook', pagoId, requestId) } : {}),
    },
    payload: { action: 'payment.created', type: 'payment', data: { id: pagoId } },
  });

describe('medios de pago del club', () => {
  it('GET /public/clubs/:slug informa Mercado Pago y los datos de transferencia', async () => {
    const res = await ctx.app.inject(`/public/clubs/${ctx.slug}`);
    expect(res.json().mediosPago).toEqual({
      mercadoPago: true,
      transferencia: { alias: 'la.canchita.mp', titular: 'La Canchita SRL' },
    });
  });
});

describe('Mercado Pago de punta a punta', () => {
  it('reserva → link de pago → webhook firmado → turno CONFIRMADO', async () => {
    const { codigo } = await reservaCon('16:00');
    const checkout = await ctx.app.inject({ method: 'POST', url: `/public/reservas/${codigo}/mercadopago` });
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json().urlCheckout).toMatch(/^https:\/\/mp\.test\/checkout\//);

    const turnoId = [...ctx.pasarela.preferencias.values()].at(-1)!.referenciaExterna;
    const pago = ctx.pasarela.pagar(turnoId, 1_500_000);
    const res = await webhook(pago.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, resultado: 'CONFIRMADO' });

    const comprobante = await ctx.app.inject(`/public/reservas/${codigo}`);
    expect(comprobante.json()).toMatchObject({ estado: 'CONFIRMADO', expiraEn: null });
  });

  it('webhook con firma inválida → 401 y no toca el turno', async () => {
    const { codigo } = await reservaCon('17:00');
    await ctx.app.inject({ method: 'POST', url: `/public/reservas/${codigo}/mercadopago` });
    const turnoId = [...ctx.pasarela.preferencias.values()].at(-1)!.referenciaExterna;
    const pago = ctx.pasarela.pagar(turnoId, 1_500_000);

    const sinFirma = await webhook(pago.id, { firma: false });
    expect(sinFirma.statusCode).toBe(401);
    expect(sinFirma.json().error.codigo).toBe('FIRMA_INVALIDA');
    expect((await ctx.app.inject(`/public/reservas/${codigo}`)).json().estado).toBe('PRE_RESERVADO');
  });

  it('notificaciones que no son de pagos se aceptan e ignoran; slug inexistente → 404', async () => {
    const otra = await ctx.app.inject({
      method: 'POST',
      url: `/webhooks/mercadopago/${ctx.slug}?type=merchant_order&data.id=1`,
      payload: {},
    });
    expect(otra.json()).toEqual({ ignorado: true });
    const sinClub = await ctx.app.inject({
      method: 'POST',
      url: '/webhooks/mercadopago/no-existe?type=payment&data.id=1',
    });
    expect(sinClub.statusCode).toBe(404);
  });

  it('pedir el link de una reserva ya confirmada (sin seña) → 409 RESERVA_NO_PENDIENTE', async () => {
    const res = await reservar(ctx, pedido(ctx.canchas.f5b.id, iso('2030-01-04', '15:00'))); // siesta
    const r = await ctx.app.inject({
      method: 'POST',
      url: `/public/reservas/${res.json().codigo}/mercadopago`,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.codigo).toBe('RESERVA_NO_PENDIENTE');
  });
});

describe('transferencia', () => {
  const subir = (codigo: string, datos = PNG, campo = 'comprobante') =>
    ctx.app.inject({
      method: 'POST',
      url: `/public/reservas/${codigo}/transferencia`,
      ...multipart(campo, 'comprobante.png', 'image/png', datos),
    });

  it('sube el comprobante: 201 EN_REVISION y el comprobante lo muestra', async () => {
    const { codigo } = await reservaCon('11:00');
    const res = await subir(codigo);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ estado: 'EN_REVISION' });
    expect((await ctx.app.inject(`/public/reservas/${codigo}`)).json()).toMatchObject({
      estado: 'PRE_RESERVADO',
      senaEnRevision: true,
    });
  });

  it('rechaza archivos que no son imagen/PDF, de más de 5 MB o en otro campo', async () => {
    const { codigo } = await reservaCon('12:00');
    expect((await subir(codigo, Buffer.from('MZ ejecutable'))).json().error.codigo).toBe('ARCHIVO_INVALIDO');
    const grande = await subir(codigo, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]));
    expect(grande.statusCode).toBe(413);
    expect(grande.json().error.codigo).toBe('ARCHIVO_DEMASIADO_GRANDE');
    expect((await subir(codigo, PNG, 'otro')).statusCode).toBe(400);
    expect(ctx.almacen.archivos.size).toBe(1); // solo el del test anterior
  });
});

describe('lista de espera', () => {
  const anotarse = (cuerpo: Record<string, unknown>) =>
    ctx.app.inject({ method: 'POST', url: `/public/clubs/${ctx.slug}/lista-espera`, payload: cuerpo });

  it('se anota con una franja local y no puede repetirla', async () => {
    const cuerpo = {
      cliente: { nombre: 'Espera', telefono: '11 7000-1111' },
      fecha: '2030-01-05',
      desde: '19:00',
      hasta: '23:00',
      jugadores: 5,
    };
    const res = await anotarse(cuerpo);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ estado: 'ACTIVA' });
    expect((await anotarse({ ...cuerpo, desde: '20:00' })).json().error.codigo).toBe('YA_EN_LISTA');
  });

  it('franja que cruza la medianoche y validaciones de formato', async () => {
    const ok = await anotarse({
      cliente: { nombre: 'Trasnoche', telefono: '11 7000-2222' },
      fecha: '2030-01-05',
      desde: '23:00',
      hasta: '02:00',
    });
    expect(ok.statusCode).toBe(201);
    const mal = await anotarse({
      cliente: { nombre: 'X', telefono: '1' },
      fecha: '2030-01-05',
      desde: '25:00',
      hasta: '1',
    });
    expect(mal.statusCode).toBe(400);
  });
});

describe('expiración perezosa con efectos', () => {
  it('quien toma un hold vencido dispara el aviso de vencimiento al cliente anterior', async () => {
    const primero = pedido(ctx.canchas.f7.id, iso('2030-01-05', '16:30'), { telefono: '+5491180000001' });
    await reservar(ctx, primero);
    ctx.setAhora(new Date(AHORA.getTime() + 11 * 60_000));
    const segundo = await reservar(ctx, pedido(ctx.canchas.f7.id, iso('2030-01-05', '16:30')));
    expect(segundo.statusCode).toBe(201);

    const avisos = await ctx.db
      .select()
      .from(notificaciones)
      .where(eq(notificaciones.destino, '+5491180000001'));
    expect(avisos.map((a) => a.plantilla)).toEqual(['reserva_expirada']);
  });
});
