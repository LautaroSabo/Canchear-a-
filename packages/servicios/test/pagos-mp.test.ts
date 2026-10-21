import { crearClubDemo } from '@cancheria/db';
import { turnos } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { AHORA, ba, type Contexto, crearContexto, PNG } from './helpers.ts';

let ctx: Contexto;
beforeEach(async () => {
  ctx = await crearContexto({ pool: 15 });
  return () => ctx.cerrar();
});

const SENA = 2_250_000; // 50% de $45.000 (sábado, pico)

describe('checkout de Mercado Pago', () => {
  it('crea la preferencia con vencimiento = expira_en y la reusa en el segundo clic', async () => {
    const t = await ctx.hold();
    const a = await ctx.pagos.checkoutMp(t.codigoCheckin);
    const b = await ctx.pagos.checkoutMp(t.codigoCheckin);
    expect(b.urlCheckout).toBe(a.urlCheckout);

    expect(ctx.pasarela.preferencias.size).toBe(1);
    const [pref] = [...ctx.pasarela.preferencias.values()];
    expect(pref).toMatchObject({
      token: 'TEST-token',
      monto: SENA,
      moneda: 'ARS',
      referenciaExterna: t.id,
      vence: t.expiraEn,
      urlNotificacion: `https://api.cancheria.test/webhooks/mercadopago/${ctx.slug}`,
      urlRetorno: `https://cancheria.test/r/${t.codigoCheckin}`,
    });
    expect(await ctx.pagosDe(t.id)).toMatchObject([
      { estado: 'PENDIENTE', proveedor: 'MERCADO_PAGO', monto: SENA },
    ]);
  });

  it('dos clics simultáneos: un solo pago abierto y el mismo link', async () => {
    const t = await ctx.hold();
    const [a, b] = await Promise.all([
      ctx.pagos.checkoutMp(t.codigoCheckin),
      ctx.pagos.checkoutMp(t.codigoCheckin),
    ]);
    expect(a.urlCheckout).toBe(b.urlCheckout);
    expect(await ctx.pagosDe(t.id)).toHaveLength(1);
  });

  it('si la reserva se extendió (transferencia rechazada), genera un link nuevo que vence con ella', async () => {
    const t = await ctx.hold();
    const viejo = await ctx.pagos.checkoutMp(t.codigoCheckin);
    await ctx.pagos.registrarTransferencia(t.codigoCheckin, PNG); // extiende el hold 60 min
    const [transferencia] = (await ctx.pagosDe(t.id)).filter((p) => p.proveedor === 'TRANSFERENCIA');
    await ctx.pagos.rechazarTransferencia(ctx.club.id, transferencia!.id, ctx.usuario.id, 'ilegible');

    const nuevo = await ctx.pagos.checkoutMp(t.codigoCheckin);
    expect(nuevo.urlCheckout).not.toBe(viejo.urlCheckout);
    const extendida = (await ctx.turno(t.id)).expiraEn;
    expect([...ctx.pasarela.preferencias.values()].at(-1)?.vence).toEqual(extendida);
    // El checkout viejo queda cerrado: sigue habiendo un solo pago de MP abierto.
    const mp = (await ctx.pagosDe(t.id)).filter((p) => p.proveedor === 'MERCADO_PAGO');
    expect(mp.map((p) => p.estado).sort()).toEqual(['PENDIENTE', 'RECHAZADO']);
  });

  it('MP caído: 502 MP_SIN_RESPUESTA, sin dejar un pago abierto; al reintentar funciona', async () => {
    const t = await ctx.hold();
    ctx.pasarela.fallarProximaPreferencia = true;
    await expect(ctx.pagos.checkoutMp(t.codigoCheckin)).rejects.toMatchObject({
      status: 502,
      codigo: 'MP_SIN_RESPUESTA',
    });
    expect(await ctx.pagosDe(t.id)).toHaveLength(0);
    await expect(ctx.pagos.checkoutMp(t.codigoCheckin)).resolves.toHaveProperty('urlCheckout');
  });

  it('rechaza holds vencidos y clubs sin Mercado Pago', async () => {
    const t = await ctx.hold();
    ctx.avanzar(11);
    await expect(ctx.pagos.checkoutMp(t.codigoCheckin)).rejects.toMatchObject({
      codigo: 'RESERVA_NO_PENDIENTE',
    });

    const sinMp = await crearContexto({ conMp: false });
    try {
      const t2 = await sinMp.hold();
      await expect(sinMp.pagos.checkoutMp(t2.codigoCheckin)).rejects.toMatchObject({
        codigo: 'MP_NO_DISPONIBLE',
      });
    } finally {
      await sinMp.cerrar();
    }
  });
});

describe('notificación de pago (webhook / conciliación)', () => {
  it('pago aprobado: confirma el turno, completa la fila del checkout y avisa al cliente', async () => {
    const t = await ctx.hold();
    await ctx.pagos.checkoutMp(t.codigoCheckin);
    const pago = ctx.pasarela.pagar(t.id, SENA);

    expect(await ctx.pagos.procesarNotificacionMp(ctx.club.id, pago.id)).toEqual({
      tipo: 'CONFIRMADO',
      turnoId: t.id,
    });
    expect(await ctx.turno(t.id)).toMatchObject({ estado: 'CONFIRMADO', expiraEn: null });
    expect(await ctx.pagosDe(t.id)).toMatchObject([{ estado: 'APROBADO', externalId: pago.id }]);
    const [msg] = await ctx.mensajes('reserva_confirmada');
    expect(msg?.payload).toMatchObject({
      fecha: 'sáb 05/01',
      hora: '20:00',
      link: `https://cancheria.test/r/${t.codigoCheckin}`,
    });
  });

  it('es idempotente: el mismo webhook repetido no hace nada la segunda vez', async () => {
    const t = await ctx.hold();
    const pago = ctx.pasarela.pagar(t.id, SENA);
    await ctx.pagos.procesarNotificacionMp(ctx.club.id, pago.id);
    expect(await ctx.pagos.procesarNotificacionMp(ctx.club.id, pago.id)).toEqual({ tipo: 'SIN_CAMBIOS' });
    expect(await ctx.mensajes('reserva_confirmada')).toHaveLength(1);
  });

  it('10 webhooks simultáneos del mismo pago: una confirmación, un mensaje', async () => {
    const t = await ctx.hold();
    const pago = ctx.pasarela.pagar(t.id, SENA);
    const r = await Promise.all(
      Array.from({ length: 10 }, () => ctx.pagos.procesarPagoMp(ctx.club.id, pago)),
    );
    expect(r.filter((x) => x.tipo === 'CONFIRMADO')).toHaveLength(1);
    expect(await ctx.mensajes('reserva_confirmada')).toHaveLength(1);
    expect(await ctx.pagosDe(t.id)).toHaveLength(1);
  });

  it('un pago rechazado no confirma; un segundo intento aprobado sí', async () => {
    const t = await ctx.hold();
    await ctx.pagos.checkoutMp(t.codigoCheckin);
    const rechazado = ctx.pasarela.pagar(t.id, SENA, 'rejected');
    expect(await ctx.pagos.procesarPagoMp(ctx.club.id, rechazado)).toEqual({
      tipo: 'ESTADO',
      estado: 'RECHAZADO',
    });
    expect((await ctx.turno(t.id)).estado).toBe('PRE_RESERVADO');

    const aprobado = ctx.pasarela.pagar(t.id, SENA);
    expect((await ctx.pagos.procesarPagoMp(ctx.club.id, aprobado)).tipo).toBe('CONFIRMADO');
    expect((await ctx.pagosDe(t.id)).map((p) => p.estado)).toEqual(['RECHAZADO', 'APROBADO']);
  });

  it('pago tardío con el horario todavía libre: revive el turno', async () => {
    const t = await ctx.hold();
    ctx.avanzar(11);
    await ctx.expiracion.barrer();
    expect((await ctx.turno(t.id)).estado).toBe('EXPIRADO');

    const pago = ctx.pasarela.pagar(t.id, SENA);
    expect((await ctx.pagos.procesarPagoMp(ctx.club.id, pago)).tipo).toBe('CONFIRMADO');
    expect((await ctx.turno(t.id)).estado).toBe('CONFIRMADO');
  });

  it('pago tardío con el horario ya tomado: se registra el reembolso (una sola vez)', async () => {
    const t = await ctx.hold();
    ctx.avanzar(11);
    await ctx.expiracion.barrer();
    await ctx.hold(); // otro cliente toma el mismo horario

    const pago = ctx.pasarela.pagar(t.id, SENA);
    expect(await ctx.pagos.procesarPagoMp(ctx.club.id, pago)).toEqual({
      tipo: 'REEMBOLSO',
      motivo: 'PAGO_TARDIO',
    });
    await ctx.pagos.procesarPagoMp(ctx.club.id, pago);
    const [fila] = await ctx.pagosDe(t.id).then((ps) => ps.filter((p) => p.externalId === pago.id));
    expect(await ctx.reembolsosDe(fila!.id)).toMatchObject([
      { motivo: 'PAGO_TARDIO', monto: SENA, estado: 'PENDIENTE' },
    ]);
    expect((await ctx.turno(t.id)).estado).toBe('EXPIRADO');
  });

  it('seña pagada dos veces: el segundo pago se devuelve', async () => {
    const t = await ctx.hold();
    await ctx.pagos.procesarPagoMp(ctx.club.id, ctx.pasarela.pagar(t.id, SENA));
    const segundo = ctx.pasarela.pagar(t.id, SENA);
    expect(await ctx.pagos.procesarPagoMp(ctx.club.id, segundo)).toEqual({
      tipo: 'REEMBOLSO',
      motivo: 'PAGO_DUPLICADO',
    });
  });

  it('monto menor a la seña: no confirma y se devuelve', async () => {
    const t = await ctx.hold();
    expect(await ctx.pagos.procesarPagoMp(ctx.club.id, ctx.pasarela.pagar(t.id, 100))).toEqual({
      tipo: 'REEMBOLSO',
      motivo: 'MONTO_INSUFICIENTE',
    });
    expect((await ctx.turno(t.id)).estado).toBe('PRE_RESERVADO');
  });

  it('ignora pagos sin referencia o de turnos de otro club (aunque usen el token de este)', async () => {
    const t = await ctx.hold();
    const otroClub = await crearClubDemo(ctx.db, 'otro-club');
    await ctx.db
      .update(turnos)
      .set({ clubId: otroClub.club.id })
      .where(eq(turnos.id, t.id))
      .catch(() => {});
    // El turno sigue siendo de este club (FK compuesta): se prueba con el id del otro club.
    expect((await ctx.pagos.procesarPagoMp(otroClub.club.id, ctx.pasarela.pagar(t.id, SENA))).tipo).toBe(
      'IGNORADO',
    );
    expect((await ctx.turno(t.id)).estado).toBe('PRE_RESERVADO');
    expect(
      (await ctx.pagos.procesarPagoMp(ctx.club.id, ctx.pasarela.pagar('cualquier-cosa', SENA))).tipo,
    ).toBe('IGNORADO');
  });

  it('AHORA de referencia sigue siendo viernes al mediodía', () => {
    expect(ctx.ahora()).toEqual(AHORA);
    expect(ba('2030-01-05', '20:00').toISOString()).toBe('2030-01-05T23:00:00.000Z');
  });
});
