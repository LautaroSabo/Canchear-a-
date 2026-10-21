import { clubs } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { AHORA, ba, type Contexto, crearContexto, PNG } from './helpers.ts';

let ctx: Contexto;
beforeEach(async () => {
  ctx = await crearContexto();
  return () => ctx.cerrar();
});

describe('transferencia con comprobante', () => {
  it('queda EN_REVISION, guarda el archivo y extiende el hold 60 min', async () => {
    const t = await ctx.hold();
    const r = await ctx.pagos.registrarTransferencia(t.codigoCheckin, PNG);
    expect(r).toEqual({
      estado: 'EN_REVISION',
      expiraEn: new Date(AHORA.getTime() + 60 * 60_000).toISOString(),
    });

    const [pago] = await ctx.pagosDe(t.id);
    expect(pago).toMatchObject({ proveedor: 'TRANSFERENCIA', estado: 'EN_REVISION', monto: 2_250_000 });
    expect(pago?.comprobanteUrl).toMatch(new RegExp(`^comprobantes/${ctx.club.id}/${t.id}/.+\\.png$`));
    expect(ctx.almacen.archivos.has(pago!.comprobanteUrl!)).toBe(true);
  });

  it('la extensión nunca pasa del inicio del turno', async () => {
    ctx.setAhora(ba('2030-01-05', '19:30'));
    const t = await ctx.hold(); // empieza 20:00
    const r = await ctx.pagos.registrarTransferencia(t.codigoCheckin, PNG);
    expect(r.expiraEn).toBe(ba('2030-01-05', '20:00').toISOString());
  });

  it('un segundo comprobante mientras el primero está en revisión → 409, sin dejar archivos huérfanos', async () => {
    const t = await ctx.hold();
    await ctx.pagos.registrarTransferencia(t.codigoCheckin, PNG);
    await expect(ctx.pagos.registrarTransferencia(t.codigoCheckin, PNG)).rejects.toMatchObject({
      codigo: 'COMPROBANTE_EN_REVISION',
    });
    expect(ctx.almacen.archivos.size).toBe(1);
  });

  it('valida el archivo por su contenido, no por su nombre', async () => {
    const t = await ctx.hold();
    await expect(
      ctx.pagos.registrarTransferencia(t.codigoCheckin, Buffer.from('<html>no</html>')),
    ).rejects.toMatchObject({
      codigo: 'ARCHIVO_INVALIDO',
    });
    expect(ctx.almacen.archivos.size).toBe(0);
  });

  it('club sin datos de transferencia → TRANSFERENCIA_NO_DISPONIBLE', async () => {
    await ctx.db.update(clubs).set({ datosTransferencia: null }).where(eq(clubs.id, ctx.club.id));
    const t = await ctx.hold();
    await expect(ctx.pagos.registrarTransferencia(t.codigoCheckin, PNG)).rejects.toMatchObject({
      codigo: 'TRANSFERENCIA_NO_DISPONIBLE',
    });
  });

  it('el club la aprueba: turno CONFIRMADO y aviso al cliente', async () => {
    const t = await ctx.hold();
    await ctx.pagos.registrarTransferencia(t.codigoCheckin, PNG);
    const [pago] = await ctx.pagosDe(t.id);
    expect(await ctx.pagos.aprobarTransferencia(ctx.club.id, pago!.id, ctx.usuario.id)).toEqual({
      tipo: 'CONFIRMADO',
      turnoId: t.id,
    });
    expect((await ctx.turno(t.id)).estado).toBe('CONFIRMADO');
    expect((await ctx.pagosDe(t.id))[0]).toMatchObject({ estado: 'APROBADO', revisadoPor: ctx.usuario.id });
    expect(await ctx.mensajes('reserva_confirmada')).toHaveLength(1);
    await expect(ctx.pagos.aprobarTransferencia(ctx.club.id, pago!.id, ctx.usuario.id)).rejects.toMatchObject(
      {
        codigo: 'PAGO_NO_EN_REVISION',
      },
    );
  });

  it('el club la rechaza: se avisa con el motivo y el cliente puede subir otro', async () => {
    const t = await ctx.hold();
    await ctx.pagos.registrarTransferencia(t.codigoCheckin, PNG);
    const [pago] = await ctx.pagosDe(t.id);
    await ctx.pagos.rechazarTransferencia(ctx.club.id, pago!.id, ctx.usuario.id, 'el monto no coincide');
    const [msg] = await ctx.mensajes('transferencia_rechazada');
    expect(msg?.payload).toMatchObject({ motivo: 'el monto no coincide' });
    await expect(ctx.pagos.registrarTransferencia(t.codigoCheckin, PNG)).resolves.toMatchObject({
      estado: 'EN_REVISION',
    });
  });

  it('aprobada tarde con el horario ya ocupado: queda el reembolso registrado (manual)', async () => {
    const t = await ctx.hold();
    await ctx.pagos.registrarTransferencia(t.codigoCheckin, PNG);
    ctx.avanzar(61);
    await ctx.expiracion.barrer();
    await ctx.hold();
    const [pago] = await ctx.pagosDe(t.id);
    expect(await ctx.pagos.aprobarTransferencia(ctx.club.id, pago!.id, ctx.usuario.id)).toEqual({
      tipo: 'REEMBOLSO',
      motivo: 'PAGO_TARDIO',
    });
    expect(await ctx.reembolsosDe(pago!.id)).toHaveLength(1);
    // El worker solo devuelve por Mercado Pago: este queda para el panel.
    expect(await ctx.reembolsos.procesar()).toEqual({ hechos: 0, fallidos: 0 });
  });
});
