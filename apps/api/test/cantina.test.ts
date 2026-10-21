import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Contexto, crearContexto, iso, panel, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
let admin: string;
let recepcion: string;
let productos: Record<string, { id: string; stock: number; precio: number }>;
beforeAll(async () => {
  ctx = await crearContexto();
  admin = (await usuarioPanel(ctx, 'ADMIN')).cookie;
  recepcion = (await usuarioPanel(ctx, 'RECEPCION')).cookie;
  const lista = (await panel(ctx, recepcion, 'GET', '/cantina/productos')).json();
  productos = Object.fromEntries(lista.map((p: { nombre: string }) => [p.nombre, p]));
});
afterAll(() => ctx.cerrar());

describe('cantina', () => {
  it('venta de mostrador, ventas del día y resumen', async () => {
    const res = await panel(ctx, recepcion, 'POST', '/cantina/ventas', {
      items: [{ productoId: productos['Cerveza lata']!.id, cantidad: 3 }],
      medio: 'EFECTIVO',
      idempotencyKey: randomUUID(),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ total: 900_000, items: [{ nombre: 'Cerveza lata', cantidad: 3 }] });

    const ventas = (await panel(ctx, recepcion, 'GET', '/cantina/ventas?fecha=2030-01-04')).json();
    expect(ventas).toHaveLength(1);
    const resumen = (await panel(ctx, recepcion, 'GET', '/cantina/resumen?fecha=2030-01-04')).json();
    expect(resumen).toMatchObject({ cobrado: 900_000, cobradoPorMedio: { EFECTIVO: 900_000 }, ventas: 1 });
  });

  it('a cuenta del turno: aparece en el detalle y en el saldo de la agenda', async () => {
    const t = await panel(ctx, recepcion, 'POST', '/turnos', {
      canchaId: ctx.canchas.f5a!.id,
      inicio: iso('2030-01-04', '20:00'),
      cliente: { nombre: 'Con Gaseosas', telefono: '11 5000-8888' },
      notificar: false,
    });
    const turnoId = t.json().id;
    await panel(ctx, recepcion, 'POST', '/cantina/ventas', {
      items: [{ productoId: productos['Gatorade 500ml']!.id, cantidad: 2 }],
      turnoId,
    });
    const detalle = (await panel(ctx, recepcion, 'GET', `/turnos/${turnoId}`)).json();
    expect(detalle).toMatchObject({
      precioTotal: 4_500_000,
      consumos: 500_000,
      saldo: 5_000_000,
      ventas: [{ total: 500_000, medio: null, items: [{ nombre: 'Gatorade 500ml', cantidad: 2 }] }],
    });
    const agenda = (await panel(ctx, recepcion, 'GET', '/agenda?fecha=2030-01-04')).json();
    expect(agenda.turnos.find((x: { id: string }) => x.id === turnoId)).toMatchObject({
      consumos: 500_000,
      saldo: 5_000_000,
    });

    // Anular antes de cobrar: vuelve el saldo.
    const anular = await panel(ctx, recepcion, 'POST', `/cantina/ventas/${detalle.ventas[0].id}/anular`, {
      motivo: 'Error',
    });
    expect(anular.statusCode).toBe(204);
    expect((await panel(ctx, recepcion, 'GET', `/turnos/${turnoId}`)).json().saldo).toBe(4_500_000);
  });

  it('sin stock: 409 con lo disponible', async () => {
    const res = await panel(ctx, recepcion, 'POST', '/cantina/ventas', {
      items: [{ productoId: productos['Gatorade 500ml']!.id, cantidad: 1000 }],
      medio: 'EFECTIVO',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ codigo: 'SIN_STOCK', detalle: { disponible: 24 } });
  });

  it('productos: recepción repone pero no edita ni ajusta; admin sí', async () => {
    const id = productos['Agua 500ml']!.id;
    expect(
      (await panel(ctx, recepcion, 'POST', `/cantina/productos/${id}/reposicion`, { cantidad: 12 })).json(),
    ).toEqual({
      stock: 60,
    });
    expect((await panel(ctx, recepcion, 'PATCH', `/cantina/productos/${id}`, { precio: 1 })).statusCode).toBe(
      403,
    );
    expect(
      (await panel(ctx, recepcion, 'POST', `/cantina/productos/${id}/ajuste`, { stock: 1, motivo: 'x' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await panel(ctx, admin, 'POST', `/cantina/productos/${id}/ajuste`, { stock: 58, motivo: 'Conteo' })
      ).json(),
    ).toEqual({
      stock: 58,
    });
    const mov = (await panel(ctx, admin, 'GET', `/cantina/productos/${id}/movimientos`)).json();
    expect(mov.slice(0, 2).map((m: { tipo: string; cantidad: number }) => [m.tipo, m.cantidad])).toEqual([
      ['AJUSTE', -2],
      ['REPOSICION', 12],
    ]);

    const nuevo = await panel(ctx, admin, 'POST', '/cantina/productos', {
      nombre: 'Hamburguesa',
      categoria: 'COMIDA',
      precio: 700_000,
      controlaStock: true,
      stockMinimo: 4,
      activo: true,
      stockInicial: 10,
    });
    expect(nuevo.statusCode).toBe(201);
    expect(nuevo.json()).toMatchObject({ nombre: 'Hamburguesa', stock: 10 });
  });
});
