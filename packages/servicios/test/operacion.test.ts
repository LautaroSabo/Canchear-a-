import { crearClubDemo } from '@cancheria/db';
import { listaEspera } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { codigoDesdeQr } from '../src/operacion.ts';
import { AHORA, ba, type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
beforeEach(async () => {
  ctx = await crearContexto();
  return () => ctx.cerrar();
});

const SENA = 2_250_000;
const cliente = { nombre: 'Por teléfono', telefono: '11 6000-1234' };

describe('carga manual y bloqueos', () => {
  it('turno manual: CONFIRMADO, precio de tarifa, auditoría con el usuario y WhatsApp con el comprobante', async () => {
    const t = await ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
      canchaId: ctx.canchas.f5a!.id,
      inicio: ba('2030-01-05', '20:00'),
      cliente,
      nota: 'Pagó por teléfono',
    });
    expect(t).toMatchObject({
      estado: 'CONFIRMADO',
      origen: 'MANUAL',
      precioTotal: 4_500_000,
      creadoPor: ctx.usuario.id,
    });
    expect(t.fin).toEqual(ba('2030-01-05', '21:00'));
    expect(await ctx.mensajes('reserva_confirmada')).toHaveLength(1);
  });

  it('acepta horarios fuera de grilla y precio a mano; un solapamiento devuelve con quién choca', async () => {
    const a = await ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
      canchaId: ctx.canchas.f5a!.id,
      inicio: ba('2030-01-05', '20:30'),
      fin: ba('2030-01-05', '22:00'),
      precio: 5_000_000,
      cliente,
      notificar: false,
    });
    expect(a.precioTotal).toBe(5_000_000);
    await expect(
      ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
        canchaId: ctx.canchas.f5a!.id,
        inicio: ba('2030-01-05', '21:00'),
        cliente: { nombre: 'Otro', telefono: '11 6000-9999' },
      }),
    ).rejects.toMatchObject({
      codigo: 'TURNO_OCUPADO',
      detalle: { conflictos: [{ id: a.id, cliente: 'Por teléfono', origen: 'MANUAL' }] },
    });
  });

  it('bloqueo por mantenimiento ocupa la cancha sin cliente', async () => {
    const b = await ctx.operacion.bloquear(ctx.club.id, ctx.usuario.id, {
      canchaId: ctx.canchas.f5b!.id,
      inicio: ba('2030-01-05', '08:00'),
      fin: ba('2030-01-05', '12:00'),
      motivo: 'Cambio de césped',
    });
    expect(b).toMatchObject({ origen: 'BLOQUEO', clienteId: null, nota: 'Cambio de césped' });
    await expect(ctx.hold(ctx.canchas.f5b, ba('2030-01-05', '10:00'))).rejects.toThrow();
  });

  it('valida cancha del club, duración y horarios demasiado viejos', async () => {
    const otro = await crearClubDemo(ctx.db, 'otro-club');
    const base = { inicio: ba('2030-01-05', '20:00'), cliente };
    await expect(
      ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, { ...base, canchaId: otro.canchas[0].id }),
    ).rejects.toMatchObject({ codigo: 'CANCHA_NO_ENCONTRADA' });
    await expect(
      ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
        ...base,
        canchaId: ctx.canchas.f5a!.id,
        fin: ba('2030-01-06', '03:00'),
      }),
    ).rejects.toMatchObject({ codigo: 'DURACION_INVALIDA' });
    await expect(
      ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
        ...base,
        canchaId: ctx.canchas.f5a!.id,
        inicio: ba('2030-01-04', '08:00'),
      }),
    ).rejects.toMatchObject({ codigo: 'HORARIO_PASADO' });
  });
});

describe('cancelación', () => {
  it('libera la cancha, avisa al cliente y se la ofrece a la lista de espera', async () => {
    const t = await ctx.hold();
    const cfg = (await ctx.clubs.porId(ctx.club.id))!;
    const espera = await ctx.listaEspera.inscribir(cfg, {
      cliente: { nombre: 'Espera', telefono: '+5491170000001' },
      desde: ba('2030-01-05', '19:00'),
      hasta: ba('2030-01-05', '23:00'),
    });

    const r = await ctx.operacion.cancelar(ctx.club.id, ctx.usuario.id, t.id, {
      motivo: 'lluvia',
      devolverSena: false,
    });
    expect(r.ofertaListaEspera).toBeTruthy();
    expect((await ctx.turno(t.id)).estado).toBe('CANCELADO');
    expect((await ctx.db.select().from(listaEspera).where(eq(listaEspera.id, espera.id)))[0]?.estado).toBe(
      'NOTIFICADA',
    );
    const [msg] = await ctx.mensajes('reserva_cancelada');
    expect(msg?.payload).toMatchObject({ motivo: 'lluvia', reembolso: '' });
  });

  it('con devolución: registra el reembolso de la seña de MP y lo informa en el mensaje', async () => {
    const t = await ctx.hold();
    await ctx.pagos.procesarPagoMp(ctx.club.id, ctx.pasarela.pagar(t.id, SENA));
    const r = await ctx.operacion.cancelar(ctx.club.id, ctx.usuario.id, t.id, {
      motivo: 'lluvia',
      devolverSena: true,
    });
    expect(r.senaADevolver).toBe(SENA);
    const [pago] = await ctx.pagosDe(t.id);
    expect(await ctx.reembolsosDe(pago!.id)).toMatchObject([{ motivo: 'TURNO_CANCELADO', monto: SENA }]);
    expect((await ctx.mensajes('reserva_cancelada'))[0]?.payload).toMatchObject({
      reembolso: 'Te devolvemos la seña ($22.500).',
    });
    expect(await ctx.reembolsos.procesar()).toEqual({ hechos: 1, fallidos: 0 });
  });

  it('cierra el checkout de MP abierto y no se puede cancelar dos veces', async () => {
    const t = await ctx.hold();
    await ctx.pagos.checkoutMp(t.codigoCheckin);
    await ctx.operacion.cancelar(ctx.club.id, ctx.usuario.id, t.id, { motivo: 'x', devolverSena: false });
    expect((await ctx.pagosDe(t.id))[0]?.estado).toBe('RECHAZADO');
    await expect(
      ctx.operacion.cancelar(ctx.club.id, ctx.usuario.id, t.id, { motivo: 'x', devolverSena: false }),
    ).rejects.toMatchObject({ codigo: 'NO_CANCELABLE' });
  });

  it('un turno de otro club responde como inexistente', async () => {
    const otro = await crearClubDemo(ctx.db, 'otro-club');
    const t = await ctx.hold();
    await expect(
      ctx.operacion.cancelar(otro.club.id, ctx.usuario.id, t.id, { motivo: 'x', devolverSena: false }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await ctx.turno(t.id)).estado).toBe('PRE_RESERVADO');
  });
});

describe('check-in por QR', () => {
  async function confirmado(hora = '12:00', fecha = '2030-01-04') {
    return ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
      canchaId: ctx.canchas.f5a!.id,
      inicio: ba(fecha, hora),
      cliente,
      notificar: false,
    });
  }

  it('lee la URL del comprobante o el código solo', () => {
    const c = 'ab'.repeat(16);
    expect(codigoDesdeQr(`https://cancheria.test/r/${c}`)).toBe(c);
    expect(codigoDesdeQr(`https://cancheria.test/r/${c}?utm=qr`)).toBe(c);
    expect(codigoDesdeQr(c.toUpperCase())).toBe(c);
    expect(codigoDesdeQr('https://otro.sitio/x')).toBeNull();
    expect(codigoDesdeQr(`${c}00`)).toBeNull();
  });

  it('marca PRESENTE, devuelve el saldo y es idempotente', async () => {
    const t = await confirmado();
    const r = await ctx.operacion.checkin(
      ctx.club.id,
      ctx.usuario.id,
      `https://cancheria.test/r/${t.codigoCheckin}`,
    );
    expect(r).toMatchObject({
      yaRegistrado: false,
      estado: 'PRESENTE',
      precioTotal: 3_000_000,
      pagado: 0,
      saldo: 3_000_000,
    });
    expect((await ctx.turno(t.id)).checkinPor).toBe(ctx.usuario.id);
    expect(await ctx.operacion.checkin(ctx.club.id, ctx.usuario.id, t.codigoCheckin)).toMatchObject({
      yaRegistrado: true,
    });
  });

  it('fuera de horario lo rechaza salvo que se fuerce', async () => {
    const t = await confirmado('20:00', '2030-01-05');
    await expect(ctx.operacion.checkin(ctx.club.id, ctx.usuario.id, t.codigoCheckin)).rejects.toMatchObject({
      codigo: 'FUERA_DE_HORARIO',
    });
    await expect(
      ctx.operacion.checkin(ctx.club.id, ctx.usuario.id, t.codigoCheckin, { forzar: true }),
    ).resolves.toMatchObject({ estado: 'PRESENTE' });
  });

  it('una reserva sin seña paga no hace check-in; un QR de otro club es 404', async () => {
    const t = await ctx.hold(ctx.canchas.f5a, ba('2030-01-04', '12:30'));
    await expect(ctx.operacion.checkin(ctx.club.id, ctx.usuario.id, t.codigoCheckin)).rejects.toMatchObject({
      codigo: 'NO_CONFIRMADO',
    });
    const otro = await crearClubDemo(ctx.db, 'otro-club');
    await expect(ctx.operacion.checkin(otro.club.id, ctx.usuario.id, t.codigoCheckin)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('cobros en el club', () => {
  it('la seña en efectivo confirma la reserva y avisa', async () => {
    const t = await ctx.hold();
    const r = await ctx.operacion.registrarPago(ctx.club.id, ctx.usuario.id, t.id, {
      monto: SENA,
      medio: 'EFECTIVO',
      concepto: 'SENA',
    });
    expect(r).toMatchObject({ estado: 'CONFIRMADO', pagado: SENA, saldo: SENA });
    expect(await ctx.mensajes('reserva_confirmada')).toHaveLength(1);
  });

  it('regresión: la seña cobrada sobre una reserva vencida la revive Y avisa al cliente', async () => {
    const t = await ctx.hold();
    ctx.avanzar(11);
    await ctx.expiracion.barrer();
    const r = await ctx.operacion.registrarPago(ctx.club.id, ctx.usuario.id, t.id, {
      monto: SENA,
      medio: 'EFECTIVO',
      concepto: 'SENA',
    });
    expect(r.estado).toBe('CONFIRMADO');
    expect(await ctx.mensajes('reserva_confirmada')).toHaveLength(1);
  });

  it('si la reserva venció y el horario ya se ocupó, el cobro se rechaza y no queda registrado', async () => {
    const t = await ctx.hold();
    ctx.avanzar(11);
    await ctx.expiracion.barrer();
    await ctx.hold();
    await expect(
      ctx.operacion.registrarPago(ctx.club.id, ctx.usuario.id, t.id, {
        monto: SENA,
        medio: 'EFECTIVO',
        concepto: 'SENA',
      }),
    ).rejects.toMatchObject({ codigo: 'TURNO_OCUPADO' });
    expect(await ctx.pagosDe(t.id)).toHaveLength(0);
  });

  it('el saldo descuenta lo pagado y no cuenta lo reembolsado', async () => {
    const t = await ctx.hold();
    await ctx.pagos.procesarPagoMp(ctx.club.id, ctx.pasarela.pagar(t.id, SENA));
    const duplicado = ctx.pasarela.pagar(t.id, SENA);
    await ctx.pagos.procesarPagoMp(ctx.club.id, duplicado); // → reembolso PAGO_DUPLICADO
    const r = await ctx.operacion.registrarPago(ctx.club.id, ctx.usuario.id, t.id, {
      monto: 1_000_000,
      medio: 'EFECTIVO',
      concepto: 'SALDO',
    });
    expect(r).toMatchObject({ precioTotal: 4_500_000, pagado: SENA + 1_000_000, saldo: 1_250_000 });
  });
});

describe('ausentes', () => {
  it('solo turnos confirmados que ya empezaron', async () => {
    const t = await ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
      canchaId: ctx.canchas.f5a!.id,
      inicio: ba('2030-01-04', '13:00'),
      cliente,
      notificar: false,
    });
    await expect(ctx.operacion.marcarAusente(ctx.club.id, ctx.usuario.id, t.id)).rejects.toMatchObject({
      codigo: 'TURNO_NO_EMPEZO',
    });
    ctx.setAhora(ba('2030-01-04', '13:20'));
    await expect(ctx.operacion.marcarAusente(ctx.club.id, ctx.usuario.id, t.id)).resolves.toMatchObject({
      estado: 'AUSENTE',
    });
    expect(ctx.ahora()).not.toEqual(AHORA);
  });
});
