import { torneoPartidos, turnos } from '@cancheria/db/schema';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatosTorneo } from '../src/torneos.ts';
import { ba, type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
beforeEach(async () => {
  ctx = await crearContexto();
  return () => ctx.cerrar();
});

/** Martes y jueves de 20 a 23 en la Cancha 1, desde el lunes 2030-01-07. */
const datos = (x: Partial<DatosTorneo> = {}): DatosTorneo => ({
  nombre: 'Liga de Verano',
  jugadoresPorLado: 5,
  inscripcionOnline: true,
  cantidadGrupos: 1,
  idaYVuelta: false,
  clasificanPorGrupo: 0,
  dias: [2, 4],
  horaDesde: '20:00',
  horaHasta: '23:00',
  canchaIds: [ctx.canchas.f5a!.id],
  fechaInicio: '2030-01-07',
  duracionMin: 60,
  ...x,
});

async function conEquipos(n: number, x: Partial<DatosTorneo> = {}) {
  const t = await ctx.torneos.crear(ctx.club.id, datos(x));
  for (let i = 1; i <= n; i++) {
    await ctx.torneos.agregarEquipo(ctx.club.id, t.id, {
      nombre: `Equipo ${i}`,
      delegadoNombre: `Delegado ${i}`,
      delegadoTelefono: `11 5000-00${String(i).padStart(2, '0')}`,
      // El equipo 1 no deja email: no recibe avisos.
      delegadoEmail: i === 1 ? null : `Delegado${i}@Equipo.test`,
    });
  }
  return t;
}

const partidos = (torneoId: string) =>
  ctx.db.select().from(torneoPartidos).where(eq(torneoPartidos.torneoId, torneoId));

describe('alta e inscripción', () => {
  it('arma el slug, y repite con sufijo si ya existe', async () => {
    const a = await ctx.torneos.crear(ctx.club.id, datos());
    const b = await ctx.torneos.crear(ctx.club.id, datos());
    expect(a.slug).toBe('liga-de-verano');
    expect(b.slug).toBe('liga-de-verano-2');
  });

  it('rechaza canchas de otro club y franjas donde no entra un partido', async () => {
    await expect(
      ctx.torneos.crear(ctx.club.id, datos({ canchaIds: ['00000000-0000-0000-0000-000000000000'] })),
    ).rejects.toMatchObject({ codigo: 'CANCHA_INVALIDA' });
    await expect(
      ctx.torneos.crear(ctx.club.id, datos({ horaDesde: '20:00', horaHasta: '20:30' })),
    ).rejects.toMatchObject({ codigo: 'FRANJA_CORTA' });
  });

  it('inscripción online: queda pendiente, no se repite el nombre y se cierra al empezar', async () => {
    const t = await conEquipos(3);
    const e = await ctx.torneos.inscribirOnline(ctx.slug, t.slug, {
      nombre: 'Los Pibes',
      delegadoNombre: 'Juan',
      delegadoTelefono: '11 4444-5555',
    });
    expect(e.estado).toBe('PENDIENTE');
    await expect(
      ctx.torneos.inscribirOnline(ctx.slug, t.slug, {
        nombre: 'los pibes',
        delegadoNombre: 'Otro',
        delegadoTelefono: '11 4444-6666',
      }),
    ).rejects.toMatchObject({ codigo: 'EQUIPO_REPETIDO' });

    // La vista pública no muestra pendientes ni teléfonos.
    const pub = await ctx.torneos.vistaPublica(ctx.slug, t.slug);
    expect(pub.equipos).toHaveLength(3);
    expect(JSON.stringify(pub)).not.toContain('5000');
    const priv = await ctx.torneos.vistaPanel(ctx.club.id, t.id);
    expect(priv.equipos).toHaveLength(4);

    await ctx.torneos.cambiarEstadoEquipo(ctx.club.id, t.id, e.id, 'APROBADO');
    await ctx.torneos.iniciar(ctx.club.id, t.id, ctx.usuario.id);
    await expect(
      ctx.torneos.inscribirOnline(ctx.slug, t.slug, {
        nombre: 'Tarde',
        delegadoNombre: 'X',
        delegadoTelefono: '11 4444-7777',
      }),
    ).rejects.toMatchObject({ codigo: 'INSCRIPCION_CERRADA' });
  });

  it('sin inscripción online no acepta equipos desde la web', async () => {
    const t = await conEquipos(2, { inscripcionOnline: false });
    await expect(
      ctx.torneos.inscribirOnline(ctx.slug, t.slug, {
        nombre: 'X',
        delegadoNombre: 'X',
        delegadoTelefono: '11 4444-7777',
      }),
    ).rejects.toMatchObject({ codigo: 'INSCRIPCION_CERRADA' });
  });

  it('otro club no ve ni toca el torneo', async () => {
    const t = await conEquipos(2);
    const otro = await crearContexto();
    try {
      await expect(otro.torneos.vistaPanel(otro.club.id, t.id)).rejects.toMatchObject({ status: 404 });
      await expect(otro.torneos.vistaPublica(otro.slug, t.slug)).rejects.toMatchObject({ status: 404 });
    } finally {
      await otro.cerrar();
    }
  });
});

describe('liga: fixture y agenda', () => {
  it('cada fecha en un día distinto, en la franja, bloqueando la agenda', async () => {
    const t = await conEquipos(4);
    await ctx.torneos.iniciar(ctx.club.id, t.id, ctx.usuario.id);
    const ps = (await partidos(t.id)).sort((a, b) => a.inicio!.getTime() - b.inicio!.getTime());
    // 4 equipos: 3 fechas de 2 partidos. Martes 8, jueves 10 y martes 15.
    expect(ps).toHaveLength(6);
    expect(ps.map((p) => [p.fecha, p.inicio!.toISOString()])).toEqual([
      [1, ba('2030-01-08', '20:00').toISOString()],
      [1, ba('2030-01-08', '21:00').toISOString()],
      [2, ba('2030-01-10', '20:00').toISOString()],
      [2, ba('2030-01-10', '21:00').toISOString()],
      [3, ba('2030-01-15', '20:00').toISOString()],
      [3, ba('2030-01-15', '21:00').toISOString()],
    ]);
    const bloqueos = await ctx.db
      .select()
      .from(turnos)
      .where(and(eq(turnos.clubId, ctx.club.id), eq(turnos.origen, 'BLOQUEO')));
    expect(bloqueos).toHaveLength(6);
    expect(bloqueos[0]!.nota).toMatch(/^Liga de Verano: Equipo \d vs Equipo \d$/);
    // Cada equipo juega una vez por fecha.
    for (const f of [1, 2, 3]) {
      const eq = ps.filter((p) => p.fecha === f).flatMap((p) => [p.localId, p.visitanteId]);
      expect(new Set(eq).size).toBe(4);
    }
    const v = await ctx.torneos.vistaPanel(ctx.club.id, t.id);
    expect(v.torneo.estado).toBe('EN_CURSO');
    expect(v.equipos.every((e) => e.grupo === 1)).toBe(true);
  });

  it('saltea horarios ocupados en la agenda', async () => {
    await ctx.operacion.bloquear(ctx.club.id, ctx.usuario.id, {
      canchaId: ctx.canchas.f5a!.id,
      inicio: ba('2030-01-08', '20:00'),
      fin: ba('2030-01-08', '22:00'),
      motivo: 'Mantenimiento',
    });
    const t = await conEquipos(4);
    await ctx.torneos.iniciar(ctx.club.id, t.id, ctx.usuario.id);
    const ps = (await partidos(t.id)).filter((p) => p.fecha === 1);
    expect(ps.map((p) => p.inicio!.toISOString()).sort()).toEqual([
      ba('2030-01-08', '22:00').toISOString(),
      ba('2030-01-10', '20:00').toISOString(),
    ]);
    // La fecha 2 arranca después de que terminó la 1.
    const f2 = (await partidos(t.id)).filter((p) => p.fecha === 2);
    expect(f2.every((p) => p.inicio! > ba('2030-01-10', '23:59'))).toBe(true);
  });

  it('pide 2 equipos por grupo', async () => {
    const t = await conEquipos(3, { cantidadGrupos: 2, clasificanPorGrupo: 1 });
    await expect(ctx.torneos.iniciar(ctx.club.id, t.id, ctx.usuario.id)).rejects.toMatchObject({
      codigo: 'POCOS_EQUIPOS',
    });
  });

  it('tabla, y la liga termina sola con el último resultado', async () => {
    const t = await conEquipos(3);
    await ctx.torneos.iniciar(ctx.club.id, t.id, ctx.usuario.id);
    const ps = await partidos(t.id);
    expect(ps).toHaveLength(3);
    for (const [i, p] of ps.entries()) {
      await ctx.torneos.cargarResultado(ctx.club.id, t.id, p.id, { golesLocal: i, golesVisitante: 0 });
    }
    const v = await ctx.torneos.vistaPublica(ctx.slug, t.slug);
    expect(v.torneo.estado).toBe('FINALIZADO');
    expect(v.grupos[0]!.tabla.reduce((s, f) => s + f.pj, 0)).toBe(6);
    expect(v.grupos[0]!.tabla[0]!.nombre).toMatch(/^Equipo /);
  });

  it('mover un partido libera el horario viejo y toma el nuevo', async () => {
    const t = await conEquipos(2);
    await ctx.torneos.iniciar(ctx.club.id, t.id, ctx.usuario.id);
    const [p] = await partidos(t.id);
    const viejo = p!.turnoId!;
    await ctx.torneos.moverPartido(
      ctx.club.id,
      t.id,
      p!.id,
      { inicio: ba('2030-01-09', '18:00'), canchaId: ctx.canchas.f5b!.id },
      ctx.usuario.id,
    );
    expect((await ctx.turno(viejo)).estado).toBe('CANCELADO');
    const [movido] = await partidos(t.id);
    expect(movido).toMatchObject({ canchaId: ctx.canchas.f5b!.id, inicio: ba('2030-01-09', '18:00') });
    expect((await ctx.turno(movido!.turnoId!)).estado).toBe('CONFIRMADO');

    // A un horario ocupado: 409 y queda como estaba.
    const h = await ctx.hold(ctx.canchas.f5a!, ba('2030-01-09', '20:00'));
    await expect(
      ctx.torneos.moverPartido(
        ctx.club.id,
        t.id,
        p!.id,
        { inicio: h.inicio, canchaId: ctx.canchas.f5a!.id },
        ctx.usuario.id,
      ),
    ).rejects.toMatchObject({ codigo: 'HORARIO_OCUPADO' });
    expect((await ctx.turno(movido!.turnoId!)).estado).toBe('CONFIRMADO');
  });
});

describe('grupos + eliminación', () => {
  it('cuadro con los clasificados, penales, y el campeón finaliza el torneo', async () => {
    const t = await conEquipos(8, {
      cantidadGrupos: 2,
      clasificanPorGrupo: 2,
      canchaIds: [ctx.canchas.f5a!.id, ctx.canchas.f5b!.id],
    });
    await ctx.torneos.iniciar(ctx.club.id, t.id, ctx.usuario.id);
    await expect(ctx.torneos.armarEliminacion(ctx.club.id, t.id, ctx.usuario.id)).rejects.toMatchObject({
      codigo: 'ELIMINACION_NO_DISPONIBLE',
    });
    for (const p of await partidos(t.id)) {
      await ctx.torneos.cargarResultado(ctx.club.id, t.id, p.id, { golesLocal: 2, golesVisitante: 1 });
    }
    expect((await ctx.torneos.vistaPanel(ctx.club.id, t.id)).eliminacionPendiente).toBe(true);
    await ctx.torneos.armarEliminacion(ctx.club.id, t.id, ctx.usuario.id);

    const elim = (await partidos(t.id)).filter((p) => p.fase === 'ELIMINACION');
    const semis = elim.filter((p) => p.ronda === 2);
    const final = elim.find((p) => p.ronda === 1)!;
    expect(semis).toHaveLength(2);
    expect(final.localId).toBeNull();
    // Semis cruzadas: cada una con equipos de grupos distintos.
    const v = await ctx.torneos.vistaPanel(ctx.club.id, t.id);
    const grupo = new Map(v.equipos.map((e) => [e.id, e.grupo]));
    for (const s of semis) expect(grupo.get(s.localId!)).not.toBe(grupo.get(s.visitanteId!));
    // La eliminación va después del último partido de grupos.
    const ultimoGrupos = Math.max(
      ...(await partidos(t.id)).filter((p) => p.fase === 'GRUPOS').map((p) => p.inicio!.getTime()),
    );
    expect(semis.every((s) => s.inicio!.getTime() > ultimoGrupos)).toBe(true);
    expect(final.inicio!.getTime()).toBeGreaterThan(Math.max(...semis.map((s) => s.inicio!.getTime())));

    const [s0, s1] = semis.sort((a, b) => a.orden! - b.orden!);
    await expect(
      ctx.torneos.cargarResultado(ctx.club.id, t.id, s0!.id, { golesLocal: 1, golesVisitante: 1 }),
    ).rejects.toMatchObject({ codigo: 'FALTAN_PENALES' });
    await ctx.torneos.cargarResultado(ctx.club.id, t.id, s0!.id, {
      golesLocal: 1,
      golesVisitante: 1,
      penalesLocal: 3,
      penalesVisitante: 4,
    });
    await ctx.torneos.cargarResultado(ctx.club.id, t.id, s1!.id, { golesLocal: 3, golesVisitante: 0 });
    const lista = await partidos(t.id);
    const f = lista.find((p) => p.id === final.id)!;
    expect(f.localId).toBe(s0!.visitanteId);
    expect(f.visitanteId).toBe(s1!.localId);

    await ctx.torneos.cargarResultado(ctx.club.id, t.id, f.id, { golesLocal: 0, golesVisitante: 1 });
    // Con la final jugada, no se puede dar vuelta una semi.
    await expect(
      ctx.torneos.cargarResultado(ctx.club.id, t.id, s1!.id, { golesLocal: 0, golesVisitante: 2 }),
    ).rejects.toMatchObject({ codigo: 'SIGUIENTE_JUGADO' });
    expect((await ctx.torneos.vistaPublica(ctx.slug, t.slug)).torneo.estado).toBe('FINALIZADO');
  });

  it('con clasificados que no son potencia de 2, los mejores pasan directo', async () => {
    const t = await conEquipos(6, {
      cantidadGrupos: 3,
      clasificanPorGrupo: 1,
      dias: [0, 1, 2, 3, 4, 5, 6],
      canchaIds: [ctx.canchas.f5a!.id, ctx.canchas.f5b!.id],
    });
    await ctx.torneos.iniciar(ctx.club.id, t.id, ctx.usuario.id);
    for (const p of await partidos(t.id)) {
      await ctx.torneos.cargarResultado(ctx.club.id, t.id, p.id, { golesLocal: 1, golesVisitante: 0 });
    }
    await ctx.torneos.armarEliminacion(ctx.club.id, t.id, ctx.usuario.id);
    const elim = (await partidos(t.id)).filter((p) => p.fase === 'ELIMINACION');
    // 3 clasificados → cuadro de 4: un bye (jugado, sin horario) y una semi real.
    const semis = elim.filter((p) => p.ronda === 2);
    const bye = semis.find((p) => p.visitanteId === null)!;
    expect(bye).toMatchObject({ estado: 'JUGADO', inicio: null, turnoId: null });
    const final = elim.find((p) => p.ronda === 1)!;
    expect([final.localId, final.visitanteId]).toContain(bye.ganadorId);
  });
});

describe('avisos a los delegados', () => {
  const avisos = async (plantilla: string) =>
    (await ctx.mensajes(plantilla)).sort((a, b) => a.destino.localeCompare(b.destino));

  it('al sortear, cada delegado con email recibe su primer partido y el link', async () => {
    const t = await conEquipos(4);
    await ctx.torneos.iniciar(ctx.club.id, t.id, ctx.usuario.id);
    const ms = await avisos('torneo_fixture');
    expect(ms.map((m) => m.destino)).toEqual([
      'delegado2@equipo.test',
      'delegado3@equipo.test',
      'delegado4@equipo.test',
    ]);
    expect(ms[0]).toMatchObject({ canal: 'EMAIL', clienteId: null });
    expect(ms[0]?.payload).toMatchObject({
      torneo: 'Liga de Verano',
      equipo: 'Equipo 2',
      link: `https://cancheria.test/${ctx.slug}/torneos/liga-de-verano`,
      primero: expect.stringMatching(/^(mar|jue) \d\d\/01 2[012]:00 en la Cancha 1 contra Equipo \d$/),
    });
    // La vista pública no muestra los emails; la del panel sí.
    expect(JSON.stringify(await ctx.torneos.vistaPublica(ctx.slug, t.slug))).not.toContain('@equipo.test');
    expect(
      (await ctx.torneos.vistaPanel(ctx.club.id, t.id)).equipos.find((e) => e.nombre === 'Equipo 2'),
    ).toMatchObject({
      delegadoEmail: 'delegado2@equipo.test',
    });
  });

  it('si el club mueve un partido, les avisa a los dos equipos', async () => {
    const t = await conEquipos(3);
    await ctx.torneos.iniciar(ctx.club.id, t.id, ctx.usuario.id);
    const p = (await partidos(t.id)).find((x) => x.localId && x.visitanteId)!;
    await ctx.torneos.moverPartido(
      ctx.club.id,
      t.id,
      p.id,
      { inicio: ba('2030-01-09', '18:00'), canchaId: ctx.canchas.f5b!.id },
      ctx.usuario.id,
    );
    const ms = await avisos('torneo_partido_movido');
    expect(ms.length).toBeGreaterThanOrEqual(1);
    expect(ms[0]?.payload).toMatchObject({ cuando: 'mié 09/01 18:00 en la Cancha 2' });
  });

  it('el día anterior: recordatorio a los dos equipos, una sola vez', async () => {
    const t = await conEquipos(2, { dias: [6], fechaInicio: '2030-01-05' }); // sábado 5, 20 h
    await ctx.torneos.iniciar(ctx.club.id, t.id, ctx.usuario.id);
    // El partido es el sábado a las 20: el viernes al mediodía faltan 32 horas, todavía no.
    expect(await ctx.torneos.recordarPartidos()).toEqual({ partidos: 0 });
    ctx.setAhora(ba('2030-01-04', '21:00'));
    expect(await ctx.torneos.recordarPartidos()).toEqual({ partidos: 1 });
    const ms = await avisos('torneo_proximo_partido');
    expect(ms.map((m) => m.destino)).toEqual(['delegado2@equipo.test']);
    expect(ms[0]?.payload).toMatchObject({ equipo: 'Equipo 2', rival: 'Equipo 1' });
    expect(await ctx.torneos.recordarPartidos()).toEqual({ partidos: 0 });
  });
});
