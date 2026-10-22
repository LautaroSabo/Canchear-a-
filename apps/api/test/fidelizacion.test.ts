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

describe('fidelización', () => {
  it('check-in suma puntos, se ven en el comprobante, se busca al cliente y canjea un descuento', async () => {
    // Viernes 12:00: turno a las 12:30, check-in permitido desde 1 h antes.
    const t = await panel(ctx, recepcion, 'POST', '/turnos', {
      canchaId: ctx.canchas.f5a!.id,
      inicio: iso('2030-01-04', '12:30'),
      cliente: { nombre: 'Martina Puntos', telefono: '11 5000-4545' },
      notificar: false,
    });
    const { codigo } = t.json();
    const checkin = await panel(ctx, recepcion, 'POST', '/checkin', { qr: codigo });
    expect(checkin.json()).toMatchObject({ puntosGanados: 10 });

    const publico = (await ctx.app.inject(`/public/reservas/${codigo}`)).json();
    expect(publico.puntos).toEqual({ ganados: 10, saldo: 10 });

    const [cliente] = (await panel(ctx, recepcion, 'GET', '/clientes?q=4545')).json();
    expect(cliente).toMatchObject({ nombre: 'Martina Puntos', saldoPuntos: 10, partidos: 1 });

    expect(
      (
        await panel(ctx, recepcion, 'POST', `/clientes/${cliente.id}/ajuste-puntos`, {
          puntos: 200,
          motivo: 'x',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await panel(ctx, admin, 'POST', `/clientes/${cliente.id}/ajuste-puntos`, {
          puntos: 140,
          motivo: 'Bienvenida',
        })
      ).json(),
    ).toEqual({ saldoPuntos: 150 });

    const cfg = (await panel(ctx, recepcion, 'GET', '/fidelizacion')).json();
    const descuento = cfg.premios.find((p: { tipo: string }) => p.tipo === 'DESCUENTO_PORCENTAJE');
    const canje = await panel(ctx, recepcion, 'POST', '/fidelizacion/canjes', {
      clienteId: cliente.id,
      premioId: descuento.id,
      turnoId: t.json().id,
    });
    expect(canje.statusCode).toBe(201);
    expect(canje.json()).toMatchObject({ estado: 'USADO', montoAplicado: 600_000, saldoPuntos: 0 });

    const detalle = (await panel(ctx, recepcion, 'GET', `/turnos/${t.json().id}`)).json();
    expect(detalle).toMatchObject({ precioTotal: 3_000_000, descuentos: 600_000, saldo: 2_400_000 });
    expect(detalle.canjes.aplicados).toMatchObject([
      { montoAplicado: 600_000, premio: { nombre: '20% off en un turno' } },
    ]);

    const ficha = (await panel(ctx, recepcion, 'GET', `/clientes/${cliente.id}`)).json();
    expect(ficha.movimientos.map((m: { tipo: string; puntos: number }) => [m.tipo, m.puntos])).toEqual([
      ['CANJE', -150],
      ['AJUSTE', 140],
      ['ACUMULACION', 10],
    ]);
  });

  it('configuración: solo administración edita premios, promos y puntos por partido', async () => {
    const premio = {
      nombre: 'Pecheras gratis',
      descripcion: null,
      costoPuntos: 30,
      tipo: 'PRODUCTO',
      valor: 0,
      stock: null,
      activo: true,
    };
    expect((await panel(ctx, recepcion, 'POST', '/fidelizacion/premios', premio)).statusCode).toBe(403);
    expect((await panel(ctx, admin, 'POST', '/fidelizacion/premios', premio)).statusCode).toBe(201);
    const promo = await panel(ctx, admin, 'POST', '/fidelizacion/promociones', {
      nombre: 'Domingo x3',
      diaSemana: 0,
      horaDesde: null,
      horaHasta: null,
      multiplicador: 3,
      puntosExtra: 0,
      vigenteDesde: '2030-01-01',
      vigenteHasta: null,
      activa: true,
    });
    expect(promo.statusCode).toBe(201);
    expect(
      (await panel(ctx, admin, 'PUT', '/fidelizacion/puntos-por-partido', { puntos: 15 })).statusCode,
    ).toBe(204);
    const cfg = (await panel(ctx, admin, 'GET', '/fidelizacion')).json();
    expect(cfg.puntosPorPartido).toBe(15);
    expect(cfg.promociones.map((p: { nombre: string }) => p.nombre)).toContain('Domingo x3');
    expect(
      (await panel(ctx, admin, 'DELETE', `/fidelizacion/promociones/${promo.json().id}`)).statusCode,
    ).toBe(204);
  });
});
