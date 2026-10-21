import { diasEspeciales, pagos, turnos, turnosFijos, turnosFijosOmitidos } from '@cancheria/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type DatosTurnoFijo, fechasDelFijo } from '../src/turnos-fijos.ts';
import { ba, type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
beforeEach(async () => {
  ctx = await crearContexto();
  return () => ctx.cerrar();
});

/** Martes 20:00 en la Cancha 1, cada semana, desde hoy (viernes 2030-01-04). */
const datos = (x: Partial<DatosTurnoFijo> = {}): DatosTurnoFijo => ({
  canchaId: ctx.canchas.f5a!.id,
  cliente: { nombre: 'Los del Martes', telefono: '11 5000-1234' },
  diaSemana: 2,
  horaInicio: '20:00',
  frecuenciaSemanas: 1,
  vigenteDesde: '2030-01-04',
  ...x,
});

const generados = (fijoId: string) =>
  ctx.db.select().from(turnos).where(eq(turnos.turnoFijoId, fijoId)).orderBy(asc(turnos.inicio));
const fechas = async (fijoId: string) =>
  (await generados(fijoId)).filter((t) => t.estado === 'CONFIRMADO').map((t) => t.inicio.toISOString());
const omitidos = (fijoId: string) =>
  ctx.db
    .select()
    .from(turnosFijosOmitidos)
    .where(eq(turnosFijosOmitidos.turnoFijoId, fijoId))
    .orderBy(asc(turnosFijosOmitidos.fecha));

describe('fechas de un turno fijo', () => {
  const f = { vigenteDesde: '2030-01-08', vigenteHasta: null, frecuenciaSemanas: 1 };
  it('semanal, quincenal anclado en la primera fecha, y con fin', () => {
    expect(fechasDelFijo(f, '2030-01-01', '2030-01-22')).toEqual(['2030-01-08', '2030-01-15', '2030-01-22']);
    expect(fechasDelFijo({ ...f, frecuenciaSemanas: 2 }, '2030-01-09', '2030-02-28')).toEqual([
      '2030-01-22',
      '2030-02-05',
      '2030-02-19',
    ]);
    expect(fechasDelFijo({ ...f, vigenteHasta: '2030-01-15' }, '2030-01-01', '2030-03-01')).toEqual([
      '2030-01-08',
      '2030-01-15',
    ]);
  });
});

describe('alta y materialización', () => {
  it('genera 8 semanas de turnos confirmados, con la tarifa de cada fecha, y le avisa al cliente', async () => {
    const r = await ctx.turnosFijos.crear(ctx.club.id, ctx.usuario.id, datos());
    expect(r).toMatchObject({ creados: 8, omitidos: [] });
    const ts = await generados(r.id);
    expect(ts[0]).toMatchObject({
      inicio: ba('2030-01-08', '20:00'),
      fin: ba('2030-01-08', '21:00'),
      estado: 'CONFIRMADO',
      origen: 'FIJO',
      precioTotal: 4_500_000,
      montoSena: 0,
    });
    expect(ts.at(-1)?.inicio).toEqual(ba('2030-02-26', '20:00'));
    const [m] = await ctx.mensajes('turno_fijo_creado');
    expect(m?.payload).toMatchObject({ dia: 'martes', hora: '20:00', cancha: 'Cancha 1' });
    const [f] = await ctx.db.select().from(turnosFijos).where(eq(turnosFijos.id, r.id));
    expect(f).toMatchObject({ vigenteDesde: '2030-01-08', materializadoHasta: '2030-03-01' });
  });

  it('nunca pisa una reserva: la fecha queda omitida, y al liberarse se puede reintentar', async () => {
    const otro = await ctx.operacion.crearManual(ctx.club.id, ctx.usuario.id, {
      canchaId: ctx.canchas.f5a!.id,
      inicio: ba('2030-01-15', '19:30'),
      cliente: { nombre: 'Juan', telefono: '11 5000-9999' },
    });
    const prev = await ctx.turnosFijos.previsualizar(ctx.club.id, datos());
    expect(prev.ocurrencias.find((o) => o.fecha === '2030-01-15')).toMatchObject({
      estado: 'OCUPADO',
      conflicto: { turnoId: otro.id, cliente: 'Juan' },
    });

    const r = await ctx.turnosFijos.crear(ctx.club.id, ctx.usuario.id, datos());
    expect(r.creados).toBe(7);
    expect(r.omitidos).toEqual([{ fecha: '2030-01-15', motivo: 'OCUPADO' }]);
    expect((await ctx.turno(otro.id)).estado).toBe('CONFIRMADO');
    expect(await omitidos(r.id)).toMatchObject([
      { fecha: '2030-01-15', motivo: 'OCUPADO', turnoConflictoId: otro.id },
    ]);

    expect(await ctx.turnosFijos.reintentar(ctx.club.id, ctx.usuario.id, r.id, '2030-01-15')).toEqual({
      creado: false,
      motivo: 'OCUPADO',
    });
    await ctx.operacion.cancelar(ctx.club.id, ctx.usuario.id, otro.id, {
      motivo: 'Se mudó',
      devolverSena: false,
    });
    expect(await ctx.turnosFijos.reintentar(ctx.club.id, ctx.usuario.id, r.id, '2030-01-15')).toEqual({
      creado: true,
      motivo: null,
    });
    expect(await omitidos(r.id)).toEqual([]);
    expect(await fechas(r.id)).toHaveLength(8);
  });

  it('feriado cerrado y horario fuera de la apertura: se omiten como CERRADO', async () => {
    await ctx.db.insert(diasEspeciales).values({ clubId: ctx.club.id, fecha: '2030-01-22', cerrado: true });
    ctx.clubs.invalidar();
    const r = await ctx.turnosFijos.crear(ctx.club.id, ctx.usuario.id, datos());
    expect(r.omitidos).toEqual([{ fecha: '2030-01-22', motivo: 'CERRADO' }]);

    const temprano = await ctx.turnosFijos.previsualizar(ctx.club.id, datos({ horaInicio: '08:00' }));
    expect(new Set(temprano.ocurrencias.map((o) => o.estado))).toEqual(new Set(['CERRADO']));
  });

  it('madrugada: domingo 01:00 entra en la jornada del sábado (abre hasta las 02:00); viernes 01:00 no (el jueves cierra a las 00:00)', async () => {
    const domingo = await ctx.turnosFijos.previsualizar(
      ctx.club.id,
      datos({ diaSemana: 0, horaInicio: '01:00', precioPactado: 1 }),
    );
    expect(domingo.ocurrencias[0]).toMatchObject({ fecha: '2030-01-06', estado: 'LIBRE' });
    const viernes = await ctx.turnosFijos.previsualizar(
      ctx.club.id,
      datos({ diaSemana: 5, horaInicio: '01:00', precioPactado: 1 }),
    );
    expect(viernes.ocurrencias[0]?.estado).toBe('CERRADO');
  });

  it('quincenal: la mitad de fechas', async () => {
    const r = await ctx.turnosFijos.crear(ctx.club.id, ctx.usuario.id, datos({ frecuenciaSemanas: 2 }));
    expect(await fechas(r.id)).toEqual(
      ['2030-01-08', '2030-01-22', '2030-02-05', '2030-02-19'].map((d) => ba(d, '20:00').toISOString()),
    );
  });

  it('idempotente: una semana cancelada no se regenera; el horizonte avanza con el tiempo', async () => {
    const r = await ctx.turnosFijos.crear(ctx.club.id, ctx.usuario.id, datos());
    const [primero] = await generados(r.id);
    await ctx.operacion.cancelar(ctx.club.id, ctx.usuario.id, primero!.id, {
      motivo: 'No vienen',
      devolverSena: false,
    });
    await ctx.db.update(turnosFijos).set({ materializadoHasta: null }).where(eq(turnosFijos.id, r.id));
    expect((await ctx.turnosFijos.materializar(r.id)).creados).toBe(0);
    expect(await fechas(r.id)).toHaveLength(7);

    ctx.avanzar(7 * 24 * 60);
    expect(await ctx.turnosFijos.materializarPendientes()).toMatchObject({ creados: 1 });
    expect((await fechas(r.id)).at(-1)).toBe(ba('2030-03-05', '20:00').toISOString());
    expect(await ctx.turnosFijos.materializarPendientes()).toMatchObject({ creados: 0 });
  });

  it('el panel y el worker materializando a la vez no duplican', async () => {
    const r = await ctx.turnosFijos.crear(ctx.club.id, ctx.usuario.id, datos());
    await ctx.db.delete(turnos).where(eq(turnos.turnoFijoId, r.id));
    await ctx.db.update(turnosFijos).set({ materializadoHasta: null }).where(eq(turnosFijos.id, r.id));
    const res = await Promise.all([
      ctx.turnosFijos.materializar(r.id),
      ctx.turnosFijos.materializarPendientes(),
      ctx.turnosFijos.materializar(r.id),
    ]);
    expect(res[0].creados + res[1].creados + res[2].creados).toBe(8);
    expect(await fechas(r.id)).toHaveLength(8);
  });
});

describe('cambios y baja', () => {
  it('precio pactado: se aplica a los turnos futuros sin pagos', async () => {
    const r = await ctx.turnosFijos.crear(ctx.club.id, ctx.usuario.id, datos({ precioPactado: 4_000_000 }));
    const [primero, segundo] = await generados(r.id);
    expect(primero?.precioTotal).toBe(4_000_000);
    await ctx.operacion.registrarPago(ctx.club.id, ctx.usuario.id, primero!.id, {
      monto: 1_000_000,
      medio: 'EFECTIVO',
      concepto: 'SALDO',
    });
    expect(
      await ctx.turnosFijos.modificar(ctx.club.id, ctx.usuario.id, r.id, { precioPactado: 3_800_000 }),
    ).toEqual({
      actualizados: 7,
    });
    expect((await ctx.turno(primero!.id)).precioTotal).toBe(4_000_000);
    expect((await ctx.turno(segundo!.id)).precioTotal).toBe(3_800_000);
    // Volver a la tarifa del club.
    await ctx.turnosFijos.modificar(ctx.club.id, ctx.usuario.id, r.id, { precioPactado: null });
    expect((await ctx.turno(segundo!.id)).precioTotal).toBe(4_500_000);
  });

  it('baja desde una fecha: cancela lo generado desde ahí (menos lo que tiene pagos) y no genera más', async () => {
    const r = await ctx.turnosFijos.crear(ctx.club.id, ctx.usuario.id, datos());
    const ts = await generados(r.id);
    const conPago = ts[5]!; // 2030-02-12
    await ctx.db.insert(pagos).values({
      clubId: ctx.club.id,
      turnoId: conPago.id,
      proveedor: 'EFECTIVO',
      concepto: 'SALDO',
      estado: 'APROBADO',
      monto: 1_000,
    });
    expect(
      await ctx.turnosFijos.darDeBaja(ctx.club.id, ctx.usuario.id, r.id, { desde: '2030-01-29' }),
    ).toEqual({
      cancelados: 4,
      conPagos: 1,
    });
    expect(await fechas(r.id)).toEqual(
      ['2030-01-08', '2030-01-15', '2030-01-22', '2030-02-12'].map((d) => ba(d, '20:00').toISOString()),
    );
    const [f] = await ctx.db.select().from(turnosFijos).where(eq(turnosFijos.id, r.id));
    expect(f).toMatchObject({ vigenteHasta: '2030-01-28', activo: true });
    ctx.avanzar(30 * 24 * 60);
    expect((await ctx.turnosFijos.materializarPendientes()).creados).toBe(0);
    const [lista] = await ctx.turnosFijos.listar(ctx.club.id);
    expect(lista).toMatchObject({ activo: false, cliente: { nombre: 'Los del Martes' } });
  });

  it('listado con próximo turno y fechas pendientes; descartar una omitida', async () => {
    await ctx.operacion.bloquear(ctx.club.id, ctx.usuario.id, {
      canchaId: ctx.canchas.f5a!.id,
      inicio: ba('2030-01-15', '18:00'),
      fin: ba('2030-01-15', '23:00'),
      motivo: 'Torneo',
    });
    const r = await ctx.turnosFijos.crear(ctx.club.id, ctx.usuario.id, datos({ nota: 'Pagan por mes' }));
    const [f] = await ctx.turnosFijos.listar(ctx.club.id);
    expect(f).toMatchObject({
      id: r.id,
      cancha: 'Cancha 1',
      horaInicio: '20:00',
      nota: 'Pagan por mes',
      activo: true,
      proximo: ba('2030-01-08', '20:00').toISOString(),
      omitidos: [{ fecha: '2030-01-15', motivo: 'OCUPADO', conflicto: 'Bloqueo' }],
    });
    expect(await ctx.turnosFijos.pendientes(ctx.club.id)).toBe(1);
    await ctx.turnosFijos.descartarOmitido(ctx.club.id, r.id, '2030-01-15');
    expect(await ctx.turnosFijos.pendientes(ctx.club.id)).toBe(0);
    const otro = await ctx.db
      .select()
      .from(turnosFijosOmitidos)
      .where(and(eq(turnosFijosOmitidos.turnoFijoId, r.id)));
    expect(otro[0]?.revisadoEn).not.toBeNull();
  });
});
