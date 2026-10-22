import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Contexto, crearContexto, iso, panel, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
let admin: string;
let recepcion: string;
beforeAll(async () => {
  ctx = await crearContexto();
  admin = (await usuarioPanel(ctx, 'ADMIN')).cookie;
  recepcion = (await usuarioPanel(ctx, 'RECEPCION')).cookie;
});
afterAll(() => ctx.cerrar());

describe('reportes', () => {
  it('resumen del período (solo administración)', async () => {
    const t = await panel(ctx, admin, 'POST', '/turnos', {
      canchaId: ctx.canchas.f5a!.id,
      inicio: iso('2030-01-04', '12:30'),
      cliente: { nombre: 'Reporte', telefono: '11 5000-9191' },
      notificar: false,
    });
    await panel(ctx, admin, 'POST', '/checkin', { qr: t.json().codigo });
    await panel(ctx, admin, 'POST', `/turnos/${t.json().id}/pagos`, {
      monto: 3_000_000,
      medio: 'EFECTIVO',
      concepto: 'SALDO',
    });

    expect(
      (await panel(ctx, recepcion, 'GET', '/reportes?desde=2030-01-01&hasta=2030-01-31')).statusCode,
    ).toBe(403);
    const r = await panel(ctx, admin, 'GET', '/reportes?desde=2030-01-01&hasta=2030-01-31');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      dinero: { cobrado: 3_000_000, porMedio: { EFECTIVO: 3_000_000 } },
      turnos: { jugados: 1 },
    });
    expect(r.json().porDia).toHaveLength(31);
    expect(r.json().ocupacion.mapa).toHaveLength(7);
    expect((await panel(ctx, admin, 'GET', '/reportes?desde=2030-02-01&hasta=2030-01-01')).statusCode).toBe(
      422,
    );
  });

  it('exportar CSV con nombre de archivo', async () => {
    const res = await panel(
      ctx,
      admin,
      'GET',
      '/reportes/exportar?tipo=pagos&desde=2030-01-01&hasta=2030-01-31',
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="pagos-2030-01-01-a-2030-01-31.csv"',
    );
    expect(res.body).toContain('EFECTIVO;SALDO;30000,00;Reporte;');
  });
});
