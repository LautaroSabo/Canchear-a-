import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Contexto, crearContexto, iso, panel, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
let recepcion: string;
let admin: string;
beforeAll(async () => {
  ctx = await crearContexto();
  recepcion = (await usuarioPanel(ctx, 'RECEPCION')).cookie;
  admin = (await usuarioPanel(ctx, 'ADMIN')).cookie;
});
afterAll(() => ctx.cerrar());

describe('caja por la API', () => {
  it('la recepción ve lo cobrado y cierra; el historial es para administración', async () => {
    const turno = await panel(ctx, recepcion, 'POST', '/turnos', {
      canchaId: ctx.canchas.f5a.id,
      inicio: iso('2030-01-04', '20:00'),
      cliente: { nombre: 'Caja', telefono: '11 5000-9999' },
      notificar: false,
    });
    expect(turno.statusCode).toBe(201);
    await panel(ctx, recepcion, 'POST', `/turnos/${turno.json().id}/pagos`, {
      monto: 4_500_000,
      medio: 'EFECTIVO',
      concepto: 'SALDO',
    });
    const actual = (await panel(ctx, recepcion, 'GET', '/caja')).json();
    expect(actual.efectivoEsperado).toBe(4_500_000);

    ctx.setAhora(new Date(Date.parse(iso('2030-01-04', '12:05'))));
    const cierre = await panel(ctx, recepcion, 'POST', '/caja/cierres', { efectivoContado: 4_600_000 });
    expect(cierre.statusCode).toBe(201);
    expect(cierre.json()).toMatchObject({ efectivoEsperado: 4_500_000, diferencia: 100_000 });
    expect((await panel(ctx, recepcion, 'POST', '/caja/cierres', { efectivoContado: -1 })).statusCode).toBe(
      400,
    );

    expect((await panel(ctx, recepcion, 'GET', '/caja/cierres')).statusCode).toBe(403);
    const h = (await panel(ctx, admin, 'GET', '/caja/cierres')).json();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ diferencia: 100_000, usuario: 'Usuario RECEPCION' });
  });
});
