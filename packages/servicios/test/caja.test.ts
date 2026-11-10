import { pagos, reembolsos } from '@cancheria/db/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { ba, type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
beforeEach(async () => {
  ctx = await crearContexto();
  return () => ctx.cerrar();
});

// Ahora: viernes 2030-01-04 12:00.
const turno = (hora: string) =>
  ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
    canchaId: ctx.canchas.f5a!.id,
    inicio: ba('2030-01-04', hora),
    cliente: { nombre: 'Equipo', telefono: '11 5000-7777' },
    notificar: false,
  });
const cobrar = async (
  hora: string,
  monto: number,
  medio: 'EFECTIVO' | 'TRANSFERENCIA',
  concepto: 'SENA' | 'SALDO',
) =>
  ctx.operacion.registrarPago(ctx.club.id, ctx.usuario.id, (await turno(hora)).id, {
    monto,
    medio,
    concepto,
  });
const fila = (r: { porMedio: { medio: string }[] }, medio: string) =>
  r.porMedio.find((f) => f.medio === medio);

describe('cierre de caja', () => {
  it('suma por medio turnos, cantina y devoluciones desde el comienzo del día', async () => {
    await cobrar('14:00', 2_000_000, 'EFECTIVO', 'SALDO');
    await cobrar('15:00', 1_000_000, 'TRANSFERENCIA', 'SENA');
    const [producto] = await ctx.cantina.productos(ctx.club.id);
    await ctx.cantina.vender(ctx.club.id, ctx.usuario.id, {
      items: [{ productoId: producto!.id, cantidad: 2 }],
      medio: 'EFECTIVO',
    });
    // Un pago de MP devuelto hoy (resta en Mercado Pago).
    const t = await turno('16:00');
    const [pago] = await ctx.db
      .insert(pagos)
      .values({
        clubId: ctx.club.id,
        turnoId: t.id,
        proveedor: 'MERCADO_PAGO',
        concepto: 'SENA',
        estado: 'APROBADO',
        monto: 500_000,
        acreditadoEn: ctx.ahora(),
      })
      .returning();
    await ctx.db.insert(reembolsos).values({
      clubId: ctx.club.id,
      pagoId: pago!.id,
      monto: 500_000,
      motivo: 'x',
      estado: 'HECHO',
      hechoEn: ctx.ahora(),
    });

    const r = await ctx.caja.actual(ctx.club.id);
    expect(r.desde).toEqual(ba('2030-01-04', '00:00'));
    expect(r.ultimoCierre).toBeNull();
    expect(fila(r, 'EFECTIVO')).toEqual({
      medio: 'EFECTIVO',
      senas: 0,
      saldos: 2_000_000,
      cantina: 2 * producto!.precio,
      devoluciones: 0,
      total: 2_000_000 + 2 * producto!.precio,
    });
    expect(fila(r, 'TRANSFERENCIA')).toMatchObject({ senas: 1_000_000, total: 1_000_000 });
    expect(fila(r, 'MERCADO_PAGO')).toMatchObject({ senas: 500_000, devoluciones: 500_000, total: 0 });
    expect(r.efectivoEsperado).toBe(2_000_000 + 2 * producto!.precio);
    expect(r.movimientos).toBe(5);
  });

  it('cerrar guarda lo esperado, lo contado y la diferencia; el siguiente arranca desde ahí', async () => {
    await cobrar('14:00', 2_000_000, 'EFECTIVO', 'SALDO');
    ctx.avanzar(60);
    const c = await ctx.caja.cerrar(ctx.club.id, ctx.usuario.id, {
      efectivoContado: 1_950_000,
      nota: 'faltan 500',
    });
    expect(c).toMatchObject({
      efectivoEsperado: 2_000_000,
      efectivoContado: 1_950_000,
      diferencia: -50_000,
      nota: 'faltan 500',
    });

    // Turno tarde: lo nuevo no se mezcla con lo ya cerrado.
    ctx.avanzar(30);
    await cobrar('18:00', 3_000_000, 'EFECTIVO', 'SALDO');
    const r = await ctx.caja.actual(ctx.club.id);
    expect(r.desde).toEqual(ba('2030-01-04', '13:00'));
    expect(r.efectivoEsperado).toBe(3_000_000);
    expect(r.ultimoCierre).toMatchObject({ usuario: 'Recepción' });

    ctx.avanzar(60);
    await ctx.caja.cerrar(ctx.club.id, ctx.usuario.id, { efectivoContado: 3_000_000 });
    const h = await ctx.caja.historial(ctx.club.id);
    expect(h.map((x) => x.diferencia)).toEqual([0, -50_000]);
    expect(h[0]).toMatchObject({ usuario: 'Recepción', efectivoEsperado: 3_000_000 });
  });

  it('dos cierres al mismo tiempo no cierran dos veces lo mismo', async () => {
    await cobrar('14:00', 2_000_000, 'EFECTIVO', 'SALDO');
    const r = await Promise.allSettled([
      ctx.caja.cerrar(ctx.club.id, ctx.usuario.id, { efectivoContado: 2_000_000 }),
      ctx.caja.cerrar(ctx.club.id, ctx.usuario.id, { efectivoContado: 2_000_000 }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.find((x) => x.status === 'rejected')).toMatchObject({ reason: { codigo: 'RECIEN_CERRADA' } });
  });
});
