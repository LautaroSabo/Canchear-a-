import { notificaciones, reembolsos } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
beforeEach(async () => {
  ctx = await crearContexto();
  return () => ctx.cerrar();
});

const SENA = 2_250_000;

async function pagoDuplicado() {
  const t = await ctx.hold();
  await ctx.pagos.procesarPagoMp(ctx.club.id, ctx.pasarela.pagar(t.id, SENA));
  const segundo = ctx.pasarela.pagar(t.id, SENA);
  await ctx.pagos.procesarPagoMp(ctx.club.id, segundo);
  const fila = (await ctx.pagosDe(t.id)).find((p) => p.externalId === segundo.id)!;
  return { t, segundo, fila };
}

describe('reembolsos', () => {
  it('se ejecutan en MP con idempotencia, marcan el pago y avisan al cliente', async () => {
    const { segundo, fila } = await pagoDuplicado();
    expect(await ctx.reembolsos.procesar()).toEqual({ hechos: 1, fallidos: 0 });

    const [r] = await ctx.reembolsosDe(fila.id);
    expect(r).toMatchObject({ estado: 'HECHO', intentos: 1 });
    expect(ctx.pasarela.reembolsos).toEqual([{ pagoId: segundo.id, idempotencia: r!.id, id: r!.externalId }]);
    expect((await ctx.pagosDe(fila.turnoId)).find((p) => p.id === fila.id)?.estado).toBe('REEMBOLSADO');
    const [msg] = await ctx.mensajes('pago_reembolsado');
    expect(msg?.payload).toMatchObject({ monto: '$22.500', motivo: 'la seña ya estaba pagada' });
    expect(await ctx.reembolsos.procesar()).toEqual({ hechos: 0, fallidos: 0 });
  });

  it('si MP falla, reintenta con backoff', async () => {
    const { fila } = await pagoDuplicado();
    ctx.pasarela.fallarProximoReembolso = true;
    expect(await ctx.reembolsos.procesar()).toEqual({ hechos: 0, fallidos: 0 });
    const [r] = await ctx.reembolsosDe(fila.id);
    expect(r).toMatchObject({ estado: 'PENDIENTE', intentos: 1, error: 'MP no disponible (simulado)' });

    expect(await ctx.reembolsos.procesar()).toEqual({ hechos: 0, fallidos: 0 }); // todavía en backoff
    ctx.avanzar(3);
    expect(await ctx.reembolsos.procesar()).toEqual({ hechos: 1, fallidos: 0 });
  });

  it('dos workers a la vez no devuelven el mismo pago dos veces', async () => {
    await pagoDuplicado();
    const [a, b] = await Promise.all([ctx.reembolsos.procesar(), ctx.reembolsos.procesar()]);
    expect(a.hechos + b.hechos).toBe(1);
    expect(ctx.pasarela.reembolsos).toHaveLength(1);
  });

  it('después de 8 intentos queda FALLIDO para revisión manual', async () => {
    const { fila } = await pagoDuplicado();
    await ctx.db.update(reembolsos).set({ intentos: 7 }).where(eq(reembolsos.pagoId, fila.id));
    ctx.pasarela.fallarProximoReembolso = true;
    expect(await ctx.reembolsos.procesar()).toEqual({ hechos: 0, fallidos: 1 });
    expect((await ctx.reembolsosDe(fila.id))[0]?.estado).toBe('FALLIDO');
  });
});

describe('despacho de notificaciones', () => {
  it('envía lo pendiente una sola vez', async () => {
    const t = await ctx.hold();
    await ctx.pagos.procesarPagoMp(ctx.club.id, ctx.pasarela.pagar(t.id, SENA));
    expect(await ctx.despachador.procesar()).toEqual({ enviadas: 1, fallidas: 0 });
    expect(ctx.canal.enviados).toMatchObject([
      { plantilla: 'reserva_confirmada', parametros: { hora: '20:00' } },
    ]);
    expect(await ctx.despachador.procesar()).toEqual({ enviadas: 0, fallidas: 0 });
  });

  it('reintenta si el canal falla y se rinde a los 6 intentos', async () => {
    const t = await ctx.hold();
    await ctx.pagos.procesarPagoMp(ctx.club.id, ctx.pasarela.pagar(t.id, SENA));
    ctx.canal.fallasPendientes = 1;
    expect(await ctx.despachador.procesar()).toEqual({ enviadas: 0, fallidas: 0 });
    ctx.avanzar(2);
    expect(await ctx.despachador.procesar()).toEqual({ enviadas: 1, fallidas: 0 });

    const t2 = await ctx.hold(ctx.canchas.f5b);
    await ctx.pagos.procesarPagoMp(ctx.club.id, ctx.pasarela.pagar(t2.id, SENA));
    await ctx.db.update(notificaciones).set({ intentos: 5 }).where(eq(notificaciones.estado, 'PENDIENTE'));
    ctx.canal.fallasPendientes = 1;
    expect((await ctx.despachador.procesar()).fallidas).toBeGreaterThanOrEqual(1);
  });
});
