import { inventarioCantina } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { aCsv, calcularOcupacion } from '../src/reportes.ts';
import { ba, type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
beforeEach(async () => {
  ctx = await crearContexto();
  return () => ctx.cerrar();
});

/** Lunes 2030-01-07: abre 10–00 en las 3 canchas (y hasta las 02:00 por la jornada del domingo). */
async function armarLunes() {
  const u = ctx.usuario.id;
  const club = ctx.club.id;
  ctx.setAhora(ba('2030-01-07', '09:00'));
  await ctx.operacion.bloquear(club, u, {
    canchaId: ctx.canchas.f5a!.id,
    inicio: ba('2030-01-07', '10:00'),
    fin: ba('2030-01-07', '12:00'),
    motivo: 'Mantenimiento',
  });
  ctx.setAhora(ba('2030-01-07', '19:30'));
  const manual = (cancha: { id: string }, hora: string, nombre: string, telefono: string) =>
    ctx.operacion.crearManual(club, u, {
      canchaId: cancha.id,
      inicio: ba('2030-01-07', hora),
      cliente: { nombre, telefono },
      notificar: false,
    });
  const jugado = await manual(ctx.canchas.f5a!, '20:00', 'Ana Jugadora', '11 5000-1001');
  const faltazo = await manual(ctx.canchas.f5b!, '21:00', 'Beto Faltazo', '11 5000-1002');
  const cancelado = await manual(ctx.canchas.f7!, '22:00', 'Caro Cancela', '11 5000-1003');
  await ctx.operacion.checkin(club, u, jugado.codigoCheckin);
  await ctx.operacion.registrarPago(club, u, jugado.id, {
    monto: 3_000_000,
    medio: 'EFECTIVO',
    concepto: 'SALDO',
  });
  await ctx.operacion.cancelar(club, u, cancelado.id, { motivo: 'Lluvia', devolverSena: false });
  const [agua] = await ctx.db
    .select()
    .from(inventarioCantina)
    .where(eq(inventarioCantina.nombre, 'Agua 500ml'));
  const [gatorade] = await ctx.db
    .select()
    .from(inventarioCantina)
    .where(eq(inventarioCantina.nombre, 'Gatorade 500ml'));
  await ctx.cantina.vender(club, u, { items: [{ productoId: agua!.id, cantidad: 2 }], medio: 'EFECTIVO' });
  await ctx.cantina.vender(club, u, {
    items: [{ productoId: gatorade!.id, cantidad: 1 }],
    turnoId: jugado.id,
  });
  ctx.setAhora(ba('2030-01-07', '21:30'));
  await ctx.operacion.marcarAusente(club, u, faltazo.id);
  return { jugado, faltazo };
}

describe('calcularOcupacion', () => {
  it('lo ocupado nunca pasa lo abierto, y los bloqueos restan de lo disponible', () => {
    const cfg = {
      club: { zonaHoraria: 'America/Argentina/Buenos_Aires' } as never,
      horarios: [{ diaSemana: 1, abre: '10:00', cierra: '12:00' }],
      especiales: [],
    };
    const b = calcularOcupacion(
      cfg,
      ['c'],
      ['2030-01-07'],
      [
        { canchaId: 'c', inicio: ba('2030-01-07', '09:00'), fin: ba('2030-01-07', '11:30'), bloqueo: false },
        { canchaId: 'c', inicio: ba('2030-01-07', '11:30'), fin: ba('2030-01-07', '12:00'), bloqueo: true },
      ],
    )[0]!;
    expect(b[9]).toEqual({ disponible: 0, ocupado: 0 });
    expect(b[10]).toEqual({ disponible: 60, ocupado: 60 });
    expect(b[11]).toEqual({ disponible: 30, ocupado: 30 });
  });
});

describe('resumen del período', () => {
  it('ocupación, plata, turnos, clientes y cantina de un día', async () => {
    const { jugado } = await armarLunes();
    const r = await ctx.reportes.resumen(ctx.club.id, '2030-01-07', '2030-01-07');
    // Lunes calendario: 00–02 (la jornada del domingo cierra a las 02:00) + 10–00, en 3 canchas, menos el bloqueo.
    expect(r.ocupacion).toMatchObject({ disponible: 3 * 16 * 60 - 120, ocupado: 120 });
    expect(r.ocupacion.porcentaje).toBeCloseTo(120 / 2760);
    expect(r.ocupacion.mapa[1]?.[20]).toEqual({ disponible: 180, ocupado: 60 });
    expect(r.ocupacion.mapa[1]?.[10]).toEqual({ disponible: 120, ocupado: 0 });
    expect(r.ocupacion.porCancha.find((c) => c.nombre === 'Cancha 1')).toMatchObject({
      ocupado: 60,
      partidos: 1,
      facturado: 4_500_000,
    });

    expect(r.dinero).toMatchObject({
      cobradoTurnos: 3_000_000,
      cobradoCantina: 300_000,
      cobrado: 3_300_000,
      porMedio: { EFECTIVO: 3_300_000 },
      porConcepto: { SALDO: 3_000_000 },
      porCobrar: 1_750_000,
      turnosConSaldo: 1,
    });
    expect(r.turnos).toMatchObject({
      porEstado: { PRESENTE: 1, AUSENTE: 1, CANCELADO: 1 },
      porOrigen: { MANUAL: 2 },
      jugados: 1,
      ausentismo: 0.5,
    });
    expect(r.clientes.frecuentes).toMatchObject([{ id: jugado.clienteId, partidos: 1 }]);
    expect(r.clientes.masAusencias).toMatchObject([{ nombre: 'Beto Faltazo', ausencias: 1 }]);
    expect(r.cantina).toMatchObject({
      mostrador: 300_000,
      aCuentaDeTurnos: 250_000,
      masVendidos: [
        { nombre: 'Agua 500ml', cantidad: 2 },
        { nombre: 'Gatorade 500ml', cantidad: 1 },
      ],
    });
    expect(r.porDia).toMatchObject([{ fecha: '2030-01-07', cobrado: 3_300_000, ocupado: 120 }]);
  });

  it('los días fuera del período no cuentan; rangos inválidos', async () => {
    await armarLunes();
    const r = await ctx.reportes.resumen(ctx.club.id, '2030-01-08', '2030-01-14');
    expect(r.ocupacion.ocupado).toBe(0);
    expect(r.dinero.cobrado).toBe(0);
    expect(r.porDia).toHaveLength(7);
    await expect(ctx.reportes.resumen(ctx.club.id, '2030-01-08', '2030-01-01')).rejects.toMatchObject({
      codigo: 'RANGO_INVALIDO',
    });
    await expect(ctx.reportes.resumen(ctx.club.id, '2030-01-01', '2031-06-01')).rejects.toMatchObject({
      codigo: 'RANGO_MUY_LARGO',
    });
  });
});

describe('exportar', () => {
  it('turnos, pagos y ventas a CSV para Excel, sin inyección de fórmulas', async () => {
    await armarLunes();
    await ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
      canchaId: ctx.canchas.f5b!.id,
      inicio: ba('2030-01-07', '23:00'),
      cliente: { nombre: '=HYPERLINK("http://x")', telefono: '11 5000-1004' },
      notificar: false,
    });
    const turnos = await ctx.reportes.filas(ctx.club.id, 'turnos', '2030-01-07', '2030-01-07');
    expect(turnos.filas).toHaveLength(5);
    const csv = aCsv(turnos);
    expect(csv.startsWith('﻿Fecha;Hora;Cancha;Cliente;')).toBe(true);
    expect(csv).toContain('2030-01-07;20:00;Cancha 1;Ana Jugadora;');
    expect(csv).toContain(';45000,00;2500,00;0,00;30000,00;17500,00\r\n');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);

    const pagos = aCsv(await ctx.reportes.filas(ctx.club.id, 'pagos', '2030-01-07', '2030-01-07'));
    expect(pagos).toContain('EFECTIVO;SALDO;30000,00;Ana Jugadora;2030-01-07 20:00;');
    const ventas = aCsv(await ctx.reportes.filas(ctx.club.id, 'ventas', '2030-01-07', '2030-01-07'));
    expect(ventas).toContain('EFECTIVO;3000,00;2 × Agua 500ml;');
    expect(ventas).toContain('A cuenta del turno;2500,00;1 × Gatorade 500ml;');
  });
});
