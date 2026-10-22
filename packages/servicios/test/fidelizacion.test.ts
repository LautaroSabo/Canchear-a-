import { canjes, clientes, movimientosPuntos, premios } from '@cancheria/db/schema';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ba, type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
let premio: Record<string, typeof premios.$inferSelect>;
beforeEach(async () => {
  ctx = await crearContexto();
  const lista = await ctx.db.select().from(premios).where(eq(premios.clubId, ctx.club.id));
  premio = Object.fromEntries(lista.map((p) => [p.nombre, p]));
  return () => ctx.cerrar();
});

const TEL = '11 5000-6060';
/** Turno manual + check-in a la hora del turno. */
async function jugar(fecha: string, hora: string, telefono = TEL) {
  ctx.setAhora(ba(fecha, hora));
  const t = await ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
    canchaId: ctx.canchas.f5a!.id,
    inicio: ba(fecha, hora),
    cliente: { nombre: 'Juana', telefono },
    notificar: false,
  });
  const r = await ctx.operacion.checkin(ctx.club.id, ctx.usuario.id, t.codigoCheckin);
  return { turno: t, ...r };
}
const saldo = async (clienteId: string) =>
  (await ctx.db.select().from(clientes).where(eq(clientes.id, clienteId)))[0]!.saldoPuntos;
/** El saldo cacheado es siempre la suma del ledger. */
async function ledgerCuadra(clienteId: string) {
  const [r] = await ctx.db
    .select({ suma: sql<number>`coalesce(sum(${movimientosPuntos.puntos}), 0)::int` })
    .from(movimientosPuntos)
    .where(eq(movimientosPuntos.clienteId, clienteId));
  expect(await saldo(clienteId)).toBe(r?.suma);
}
async function darPuntos(clienteId: string, puntos: number) {
  await ctx.fidelizacion.ajustar(ctx.club.id, ctx.usuario.id, clienteId, puntos, 'Para el test');
}

describe('acumulación en el check-in', () => {
  it('suma la base del club; las promos multiplican; check-in repetido no suma dos veces', async () => {
    const viernes = await jugar('2030-01-04', '20:00');
    expect(viernes.puntosGanados).toBe(10);
    const martes = await jugar('2030-01-08', '15:00');
    expect(martes.puntosGanados).toBe(20);
    const otra = await ctx.operacion.checkin(ctx.club.id, ctx.usuario.id, martes.turno.codigoCheckin);
    expect(otra).toMatchObject({ yaRegistrado: true, puntosGanados: 0 });
    const clienteId = martes.turno.clienteId!;
    expect(await saldo(clienteId)).toBe(30);
    await ledgerCuadra(clienteId);
    const ficha = await ctx.fidelizacion.cliente(ctx.club.id, clienteId);
    expect(ficha).toMatchObject({ partidos: 2, saldoPuntos: 30 });
    expect(ficha.movimientos[0]).toMatchObject({
      tipo: 'ACUMULACION',
      puntos: 20,
      promocion: 'Martes y miércoles valle x2',
    });
  });

  it('club con 0 puntos por partido: no acumula', async () => {
    await ctx.fidelizacion.setPuntosPorPartido(ctx.club.id, 0);
    expect((await jugar('2030-01-04', '20:00')).puntosGanados).toBe(0);
  });
});

describe('canjes', () => {
  it('producto: se entrega en el momento y descuenta puntos; sin puntos suficientes no deja', async () => {
    const { turno } = await jugar('2030-01-04', '20:00');
    const clienteId = turno.clienteId!;
    await expect(
      ctx.fidelizacion.canjear(ctx.club.id, ctx.usuario.id, {
        clienteId,
        premioId: premio['Gatorade gratis']!.id,
      }),
    ).rejects.toMatchObject({
      codigo: 'PUNTOS_INSUFICIENTES',
      message: 'Juana tiene 10 puntos y el premio cuesta 50',
    });
    await darPuntos(clienteId, 45);
    const c = await ctx.fidelizacion.canjear(ctx.club.id, ctx.usuario.id, {
      clienteId,
      premioId: premio['Gatorade gratis']!.id,
    });
    expect(c).toMatchObject({
      estado: 'USADO',
      saldoPuntos: 5,
      codigo: expect.stringMatching(/^[0-9A-F]{10}$/),
    });
    await ledgerCuadra(clienteId);
  });

  it('descuento: emitido, se aplica a un turno del cliente y baja el saldo del turno', async () => {
    const { turno: jugado } = await jugar('2030-01-04', '20:00');
    const clienteId = jugado.clienteId!;
    await darPuntos(clienteId, 200);
    const c = await ctx.fidelizacion.canjear(ctx.club.id, ctx.usuario.id, {
      clienteId,
      premioId: premio['20% off en un turno']!.id,
    });
    expect(c.estado).toBe('EMITIDO');

    const proximo = await ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
      canchaId: ctx.canchas.f5b!.id,
      inicio: ba('2030-01-11', '20:00'),
      cliente: { nombre: 'Juana', telefono: TEL },
      notificar: false,
    });
    expect((await ctx.fidelizacion.paraTurno(ctx.club.id, proximo.id)).disponibles).toHaveLength(1);
    expect(await ctx.fidelizacion.aplicar(ctx.club.id, c.id, proximo.id)).toEqual({ montoAplicado: 900_000 });
    const r = await ctx.db.transaction((tx) => ctx.operacion.resumen(tx, proximo.id));
    expect(r).toMatchObject({ precioTotal: 4_500_000, descuentos: 900_000, saldo: 3_600_000 });
    await expect(ctx.fidelizacion.aplicar(ctx.club.id, c.id, proximo.id)).rejects.toMatchObject({
      codigo: 'CANJE_USADO',
    });

    // Anularlo devuelve los puntos y el saldo del turno.
    await ctx.fidelizacion.anularCanje(ctx.club.id, ctx.usuario.id, c.id, 'Se equivocó');
    expect((await ctx.db.transaction((tx) => ctx.operacion.resumen(tx, proximo.id))).saldo).toBe(4_500_000);
    expect(await saldo(clienteId)).toBe(210);
    await ledgerCuadra(clienteId);
  });

  it('turno gratis con seña pagada: descuenta solo lo que falta, nunca deja saldo a favor', async () => {
    const { turno } = await jugar('2030-01-04', '20:00');
    const clienteId = turno.clienteId!;
    await darPuntos(clienteId, 400);
    await ctx.operacion.registrarPago(ctx.club.id, ctx.usuario.id, turno.id, {
      monto: 1_000_000,
      medio: 'EFECTIVO',
      concepto: 'SALDO',
    });
    const c = await ctx.fidelizacion.canjear(ctx.club.id, ctx.usuario.id, {
      clienteId,
      premioId: premio['Turno F5 gratis (valle)']!.id,
      turnoId: turno.id,
    });
    expect(c).toMatchObject({ estado: 'USADO', montoAplicado: 3_500_000 });
    expect((await ctx.db.transaction((tx) => ctx.operacion.resumen(tx, turno.id))).saldo).toBe(0);
  });

  it('no se aplica al turno de otra persona; stock de premios', async () => {
    const { turno } = await jugar('2030-01-04', '20:00');
    const otro = await jugar('2030-01-04', '21:00', '11 5000-7070');
    await darPuntos(turno.clienteId!, 300);
    await expect(
      ctx.fidelizacion.canjear(ctx.club.id, ctx.usuario.id, {
        clienteId: turno.clienteId!,
        premioId: premio['20% off en un turno']!.id,
        turnoId: otro.turno.id,
      }),
    ).rejects.toMatchObject({ codigo: 'TURNO_DE_OTRO_CLIENTE' });
    // El rollback devolvió todo.
    expect(await saldo(turno.clienteId!)).toBe(310);
    expect(await ctx.db.select().from(canjes)).toEqual([]);

    await ctx.db.update(premios).set({ stock: 1 }).where(eq(premios.id, premio['Gatorade gratis']!.id));
    await ctx.fidelizacion.canjear(ctx.club.id, ctx.usuario.id, {
      clienteId: turno.clienteId!,
      premioId: premio['Gatorade gratis']!.id,
    });
    await expect(
      ctx.fidelizacion.canjear(ctx.club.id, ctx.usuario.id, {
        clienteId: turno.clienteId!,
        premioId: premio['Gatorade gratis']!.id,
      }),
    ).rejects.toMatchObject({ codigo: 'PREMIO_AGOTADO' });
  });

  it('dos canjes simultáneos con puntos para uno solo: pasa uno', async () => {
    const { turno } = await jugar('2030-01-04', '20:00');
    await darPuntos(turno.clienteId!, 90); // 100 puntos: alcanza para 2 Gatorades, no para 3
    const r = await Promise.allSettled(
      [1, 2, 3].map(() =>
        ctx.fidelizacion.canjear(ctx.club.id, ctx.usuario.id, {
          clienteId: turno.clienteId!,
          premioId: premio['Gatorade gratis']!.id,
        }),
      ),
    );
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(2);
    expect(await saldo(turno.clienteId!)).toBe(0);
    await ledgerCuadra(turno.clienteId!);
  });
});

describe('clientes y configuración', () => {
  it('búsqueda por nombre y por últimos dígitos del teléfono', async () => {
    await jugar('2030-01-04', '20:00');
    expect((await ctx.fidelizacion.buscarClientes(ctx.club.id, 'juan')).map((c) => c.nombre)).toEqual([
      'Juana',
    ]);
    expect(await ctx.fidelizacion.buscarClientes(ctx.club.id, '6060')).toMatchObject([
      { nombre: 'Juana', saldoPuntos: 10, partidos: 1 },
    ]);
    expect(await ctx.fidelizacion.buscarClientes(ctx.club.id, 'zzz')).toEqual([]);
  });

  it('ajuste no deja saldo negativo; premios y promos se validan', async () => {
    const { turno } = await jugar('2030-01-04', '20:00');
    await expect(
      ctx.fidelizacion.ajustar(ctx.club.id, ctx.usuario.id, turno.clienteId!, -11, 'x'),
    ).rejects.toMatchObject({
      codigo: 'PUNTOS_INSUFICIENTES',
    });
    await expect(
      ctx.fidelizacion.crearPremio(ctx.club.id, {
        nombre: 'Mal',
        descripcion: null,
        costoPuntos: 10,
        tipo: 'DESCUENTO_PORCENTAJE',
        valor: 150,
        stock: null,
        activo: true,
      }),
    ).rejects.toMatchObject({ codigo: 'PORCENTAJE_INVALIDO' });
    const promo = await ctx.fidelizacion.crearPromocion(ctx.club.id, {
      nombre: 'Viernes noche',
      diaSemana: 5,
      horaDesde: '20:00',
      horaHasta: '00:00',
      multiplicador: 1.5,
      puntosExtra: 5,
      vigenteDesde: '2030-01-01',
      vigenteHasta: null,
      activa: true,
    });
    expect((await jugar('2030-01-11', '21:00')).puntosGanados).toBe(20);
    const cfg = await ctx.fidelizacion.configuracion(ctx.club.id);
    expect(cfg.promociones.find((p) => p.id === promo!.id)).toMatchObject({
      multiplicador: 1.5,
      horaDesde: '20:00',
    });
    await ctx.fidelizacion.borrarPromocion(ctx.club.id, promo!.id);
    expect((await ctx.fidelizacion.configuracion(ctx.club.id)).promociones).toHaveLength(2);
  });
});
