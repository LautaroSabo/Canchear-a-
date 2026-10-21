import { randomUUID } from 'node:crypto';
import { inventarioCantina, movimientosStock } from '@cancheria/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ba, type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
let p: Record<string, typeof inventarioCantina.$inferSelect>;
beforeEach(async () => {
  ctx = await crearContexto();
  const lista = await ctx.cantina.productos(ctx.club.id);
  p = Object.fromEntries(lista.map((x) => [x.nombre, x]));
  return () => ctx.cerrar();
});

const stock = async (id: string) =>
  (await ctx.db.select().from(inventarioCantina).where(eq(inventarioCantina.id, id)))[0]!.stock;
const turnoManual = (hora = '20:00') =>
  ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
    canchaId: ctx.canchas.f5a!.id,
    inicio: ba('2030-01-04', hora),
    cliente: { nombre: 'Equipo', telefono: '11 5000-7777' },
    notificar: false,
  });

describe('ventas de mostrador', () => {
  it('descuenta stock (no en alquileres), congela el precio y deja el libro', async () => {
    const v = await ctx.cantina.vender(ctx.club.id, ctx.usuario.id, {
      items: [
        { productoId: p['Agua 500ml']!.id, cantidad: 2 },
        { productoId: p['Alquiler pelota']!.id, cantidad: 1 },
        { productoId: p['Agua 500ml']!.id, cantidad: 1 },
      ],
      medio: 'EFECTIVO',
    });
    expect(v.total).toBe(3 * 150_000 + 200_000);
    expect(await stock(p['Agua 500ml']!.id)).toBe(45);
    expect(await stock(p['Alquiler pelota']!.id)).toBe(0);

    await ctx.cantina.actualizarProducto(ctx.club.id, p['Agua 500ml']!.id, { precio: 180_000 });
    const [guardada] = await ctx.cantina.ventas(ctx.club.id, { fecha: '2030-01-04' });
    expect(guardada?.items).toContainEqual(
      expect.objectContaining({ nombre: 'Agua 500ml', cantidad: 3, precioUnitario: 150_000 }),
    );

    const mov = await ctx.cantina.movimientos(ctx.club.id, p['Agua 500ml']!.id);
    expect(mov[0]).toMatchObject({ tipo: 'VENTA', cantidad: -3, stockResultante: 45, ventaId: v.id });
  });

  it('sin stock suficiente no vende nada (todo o nada)', async () => {
    await expect(
      ctx.cantina.vender(ctx.club.id, ctx.usuario.id, {
        items: [
          { productoId: p['Agua 500ml']!.id, cantidad: 1 },
          { productoId: p['Gatorade 500ml']!.id, cantidad: 25 },
        ],
        medio: 'EFECTIVO',
      }),
    ).rejects.toMatchObject({ codigo: 'SIN_STOCK', message: 'Quedan 24 de Gatorade 500ml y pediste 25' });
    expect(await stock(p['Agua 500ml']!.id)).toBe(48);
    expect(await ctx.cantina.ventas(ctx.club.id, { fecha: '2030-01-04' })).toEqual([]);
  });

  it('dos cajas vendiendo el último a la vez: una sola lo vende', async () => {
    await ctx.cantina.ajustar(ctx.club.id, ctx.usuario.id, p['Cerveza lata']!.id, 1, 'Conteo');
    const r = await Promise.allSettled(
      [1, 2, 3].map(() =>
        ctx.cantina.vender(ctx.club.id, ctx.usuario.id, {
          items: [{ productoId: p['Cerveza lata']!.id, cantidad: 1 }],
          medio: 'EFECTIVO',
        }),
      ),
    );
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await stock(p['Cerveza lata']!.id)).toBe(0);
  });

  it('idempotente: el doble toque devuelve la misma venta', async () => {
    const pedido = {
      items: [{ productoId: p['Agua 500ml']!.id, cantidad: 1 }],
      medio: 'TRANSFERENCIA' as const,
      idempotencyKey: randomUUID(),
    };
    const [a, b] = await Promise.all([
      ctx.cantina.vender(ctx.club.id, ctx.usuario.id, pedido),
      ctx.cantina.vender(ctx.club.id, ctx.usuario.id, pedido),
    ]);
    expect(a.id).toBe(b.id);
    expect(await stock(p['Agua 500ml']!.id)).toBe(47);
  });

  it('anular devuelve el stock; no se anula dos veces', async () => {
    const v = await ctx.cantina.vender(ctx.club.id, ctx.usuario.id, {
      items: [{ productoId: p['Agua 500ml']!.id, cantidad: 4 }],
      medio: 'EFECTIVO',
    });
    await ctx.cantina.anular(ctx.club.id, ctx.usuario.id, v.id, 'Se equivocó de producto');
    expect(await stock(p['Agua 500ml']!.id)).toBe(48);
    await expect(ctx.cantina.anular(ctx.club.id, ctx.usuario.id, v.id, 'otra vez')).rejects.toMatchObject({
      codigo: 'VENTA_ANULADA',
    });
    const resumen = await ctx.cantina.resumenDia(ctx.club.id);
    expect(resumen).toMatchObject({ ventas: 0, anuladas: 1, cobrado: 0 });
  });

  it('debe decir cobrar ahora o cargar a un turno, no las dos', async () => {
    const t = await turnoManual();
    await expect(
      ctx.cantina.vender(ctx.club.id, ctx.usuario.id, {
        items: [{ productoId: p['Agua 500ml']!.id, cantidad: 1 }],
        medio: 'EFECTIVO',
        turnoId: t.id,
      }),
    ).rejects.toMatchObject({ codigo: 'DESTINO_INVALIDO' });
  });
});

describe('a cuenta del turno', () => {
  it('suma al saldo, se cobra con el turno, y una vez cobrado no se anula', async () => {
    const t = await turnoManual();
    const v = await ctx.cantina.vender(ctx.club.id, ctx.usuario.id, {
      items: [{ productoId: p['Gatorade 500ml']!.id, cantidad: 2 }],
      turnoId: t.id,
    });
    let r = await ctx.db.transaction((tx) => ctx.operacion.resumen(tx, t.id));
    expect(r).toMatchObject({ precioTotal: 4_500_000, consumos: 500_000, saldo: 5_000_000 });

    r = await ctx.operacion.registrarPago(ctx.club.id, ctx.usuario.id, t.id, {
      monto: 5_000_000,
      medio: 'EFECTIVO',
      concepto: 'SALDO',
    });
    expect(r.saldo).toBe(0);
    const e = await ctx.cantina.anular(ctx.club.id, ctx.usuario.id, v.id, 'error').catch((x: unknown) => x);
    expect(e).toMatchObject({ codigo: 'VENTA_COBRADA' });
    expect((e as Error).message).toBe(
      'Esa cuenta ya se cobró: si anulás, sobran $5.000 que habría que devolver',
    );
  });

  it('solo turnos confirmados o en cancha', async () => {
    const t = await turnoManual();
    await ctx.operacion.cancelar(ctx.club.id, ctx.usuario.id, t.id, { motivo: 'x', devolverSena: false });
    await expect(
      ctx.cantina.vender(ctx.club.id, ctx.usuario.id, {
        items: [{ productoId: p['Agua 500ml']!.id, cantidad: 1 }],
        turnoId: t.id,
      }),
    ).rejects.toMatchObject({ codigo: 'TURNO_SIN_CUENTA' });
  });
});

describe('productos y stock', () => {
  it('alta con stock inicial, nombre repetido, reposición y ajuste en el libro', async () => {
    const choripan = await ctx.cantina.crearProducto(ctx.club.id, ctx.usuario.id, {
      nombre: 'Choripán',
      categoria: 'COMIDA',
      precio: 500_000,
      controlaStock: true,
      stockMinimo: 5,
      activo: true,
      stockInicial: 20,
    });
    await expect(
      ctx.cantina.crearProducto(ctx.club.id, ctx.usuario.id, { ...choripan, stockInicial: 0 }),
    ).rejects.toMatchObject({ codigo: 'NOMBRE_EN_USO' });
    expect(await ctx.cantina.reponer(ctx.club.id, ctx.usuario.id, choripan.id, 10)).toEqual({ stock: 30 });
    expect(await ctx.cantina.ajustar(ctx.club.id, ctx.usuario.id, choripan.id, 27, 'Se quemaron 3')).toEqual({
      stock: 27,
    });
    const mov = await ctx.db
      .select()
      .from(movimientosStock)
      .where(and(eq(movimientosStock.productoId, choripan.id)))
      .orderBy(asc(movimientosStock.id));
    expect(mov.map((m) => [m.tipo, m.cantidad, m.stockResultante])).toEqual([
      ['AJUSTE', 20, 20],
      ['REPOSICION', 10, 30],
      ['AJUSTE', -3, 27],
    ]);
    await expect(
      ctx.cantina.reponer(ctx.club.id, ctx.usuario.id, p['Alquiler pelota']!.id, 1),
    ).rejects.toMatchObject({
      codigo: 'SIN_CONTROL_DE_STOCK',
    });
  });

  it('un producto dado de baja no se vende; el resumen avisa stock bajo', async () => {
    await ctx.cantina.actualizarProducto(ctx.club.id, p['Cerveza lata']!.id, { activo: false });
    await expect(
      ctx.cantina.vender(ctx.club.id, ctx.usuario.id, {
        items: [{ productoId: p['Cerveza lata']!.id, cantidad: 1 }],
        medio: 'EFECTIVO',
      }),
    ).rejects.toMatchObject({ codigo: 'PRODUCTO_NO_ENCONTRADO' });

    await ctx.cantina.ajustar(ctx.club.id, ctx.usuario.id, p['Gatorade 500ml']!.id, 3, 'Conteo');
    await ctx.cantina.vender(ctx.club.id, ctx.usuario.id, {
      items: [{ productoId: p['Agua 500ml']!.id, cantidad: 2 }],
      medio: 'MERCADO_PAGO',
    });
    const r = await ctx.cantina.resumenDia(ctx.club.id);
    expect(r).toMatchObject({
      cobradoPorMedio: { MERCADO_PAGO: 300_000 },
      cobrado: 300_000,
      masVendidos: [{ nombre: 'Agua 500ml', cantidad: 2, total: 300_000 }],
      stockBajo: [{ nombre: 'Gatorade 500ml', stock: 3, stockMinimo: 6 }],
    });
  });
});
