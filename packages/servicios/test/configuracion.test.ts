import { crearClubDemo } from '@cancheria/db';
import { clubs, sesiones, tarifas } from '@cancheria/db/schema';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type DatosTarifa, validarSemana } from '../src/configuracion.ts';
import { cotizarTurno } from '../src/cotizacion.ts';
import { ba, type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
beforeEach(async () => {
  ctx = await crearContexto();
  return () => ctx.cerrar();
});

const tarifa = (x: Partial<DatosTarifa>): DatosTarifa => ({
  canchaId: null,
  diaSemana: null,
  horaDesde: '18:00',
  horaHasta: '20:00',
  precio: 1_000_000,
  etiqueta: null,
  vigenteDesde: '2026-01-01',
  vigenteHasta: null,
  ...x,
});

describe('horarios de apertura', () => {
  it('rechaza franjas que se pisan el mismo día o con la madrugada del día anterior', () => {
    expect(() =>
      validarSemana([
        { diaSemana: 1, abre: '10:00', cierra: '14:00' },
        { diaSemana: 1, abre: '13:00', cierra: '18:00' },
      ]),
    ).toThrow(/se pisa/);
    expect(() =>
      validarSemana([
        { diaSemana: 6, abre: '20:00', cierra: '02:00' },
        { diaSemana: 0, abre: '01:00', cierra: '12:00' },
      ]),
    ).toThrow(/sábado/);
  });

  it('acepta cierres después de medianoche que no se pisan, y dos franjas en un día', () => {
    expect(() =>
      validarSemana([
        { diaSemana: 6, abre: '09:00', cierra: '02:00' },
        { diaSemana: 0, abre: '09:00', cierra: '02:00' },
        { diaSemana: 1, abre: '08:00', cierra: '12:00' },
        { diaSemana: 1, abre: '16:00', cierra: '00:00' },
      ]),
    ).not.toThrow();
  });

  it('reemplaza la semana entera y el público lo ve sin esperar la caché', async () => {
    await ctx.configuracion.reemplazarHorarios(ctx.club.id, [
      { diaSemana: 6, abre: '10:00', cierra: '12:00' },
    ]);
    const cfg = await ctx.clubs.porId(ctx.club.id);
    expect(cfg?.horarios).toEqual([{ diaSemana: 6, abre: '10:00:00', cierra: '12:00:00' }]);
    expect((await ctx.configuracion.leer(ctx.club.id)).horarios).toEqual([
      { diaSemana: 6, abre: '10:00', cierra: '12:00' },
    ]);
  });
});

describe('tarifas', () => {
  it('rechaza una tarifa que se pisa con otra del mismo alcance', async () => {
    // El seed tiene una general de todos los días 18:00–00:00.
    await expect(ctx.configuracion.crearTarifa(ctx.club.id, tarifa({}))).rejects.toMatchObject({
      codigo: 'TARIFA_SUPERPUESTA',
      message: expect.stringContaining('18:00 a 00:00'),
    });
  });

  it('con otro alcance sí (gana la más específica); no puede cruzar la medianoche', async () => {
    await ctx.configuracion.crearTarifa(
      ctx.club.id,
      tarifa({ diaSemana: 6, horaDesde: '22:00', horaHasta: '00:00', precio: 5_500_000 }),
    );
    await expect(
      ctx.configuracion.crearTarifa(
        ctx.club.id,
        tarifa({ diaSemana: 6, horaDesde: '23:00', horaHasta: '23:30' }),
      ),
    ).rejects.toMatchObject({ codigo: 'TARIFA_SUPERPUESTA' });
    await expect(
      ctx.configuracion.crearTarifa(
        ctx.club.id,
        tarifa({ diaSemana: 2, horaDesde: '23:00', horaHasta: '01:00' }),
      ),
    ).rejects.toMatchObject({ codigo: 'FRANJA_INVALIDA' });
    const cfg = (await ctx.clubs.porId(ctx.club.id))!;
    expect(cotizarTurno(cfg, ctx.canchas.f5a!, ba('2030-01-05', '23:00'))?.precio).toBe(5_500_000);
    expect(cotizarTurno(cfg, ctx.canchas.f5a!, ba('2030-01-04', '23:00'))?.precio).toBe(4_500_000);
  });

  it('vigencias que no se pisan conviven (aumento de precios programado)', async () => {
    const [pico] = await ctx.db
      .select()
      .from(tarifas)
      .where(and(eq(tarifas.clubId, ctx.club.id), eq(tarifas.horaDesde, '18:00:00')));
    await ctx.configuracion.actualizarTarifa(ctx.club.id, pico!.id, {
      ...tarifa({ horaDesde: '18:00', horaHasta: '00:00', precio: pico!.precio }),
      vigenteHasta: '2029-12-31',
    });
    await ctx.configuracion.crearTarifa(
      ctx.club.id,
      tarifa({ horaDesde: '18:00', horaHasta: '00:00', precio: 6_000_000, vigenteDesde: '2030-01-01' }),
    );
    const cfg = (await ctx.clubs.porId(ctx.club.id))!;
    expect(cotizarTurno(cfg, ctx.canchas.f5a!, ba('2030-01-05', '20:00'))?.precio).toBe(6_000_000);
  });

  it('editar una tarifa no choca consigo misma; una tarifa de otro club es 404', async () => {
    const [valle] = await ctx.db.select().from(tarifas).where(eq(tarifas.clubId, ctx.club.id));
    await expect(
      ctx.configuracion.actualizarTarifa(
        ctx.club.id,
        valle!.id,
        tarifa({ horaDesde: '00:00', horaHasta: '18:00', precio: 1 }),
      ),
    ).resolves.toBeUndefined();
    const otro = await crearClubDemo(ctx.db, 'otro-club');
    await expect(ctx.configuracion.borrarTarifa(otro.club.id, valle!.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('dos admins creando tarifas que se pisan al mismo tiempo: queda una sola', async () => {
    const nueva = tarifa({ diaSemana: 2, horaDesde: '20:00', horaHasta: '22:00' });
    const r = await Promise.allSettled([
      ctx.configuracion.crearTarifa(ctx.club.id, nueva),
      ctx.configuracion.crearTarifa(ctx.club.id, { ...nueva, horaDesde: '21:00', horaHasta: '23:00' }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.find((x) => x.status === 'rejected')).toMatchObject({
      reason: { codigo: 'TARIFA_SUPERPUESTA' },
    });
  });
});

describe('canchas', () => {
  const datos = {
    nombre: 'Cancha 4',
    jugadoresPorLado: 5,
    superficie: 'SINTETICO' as const,
    techada: false,
    iluminacion: true,
    duracionTurnoMin: 60 as const,
    orden: 4,
    activa: true,
  };

  it('alta, nombre repetido y desactivación (deja de verse en el público)', async () => {
    const c = await ctx.configuracion.crearCancha(ctx.club.id, datos);
    await expect(ctx.configuracion.crearCancha(ctx.club.id, datos)).rejects.toMatchObject({
      codigo: 'NOMBRE_EN_USO',
    });
    expect((await ctx.clubs.porId(ctx.club.id))?.canchas.map((x) => x.nombre)).toContain('Cancha 4');
    await ctx.configuracion.actualizarCancha(ctx.club.id, c!.id, { activa: false });
    expect((await ctx.clubs.porId(ctx.club.id))?.canchas.map((x) => x.nombre)).not.toContain('Cancha 4');
    expect((await ctx.configuracion.leer(ctx.club.id)).canchas.find((x) => x.id === c!.id)?.activa).toBe(
      false,
    );
  });
});

describe('reglas de seña y días especiales', () => {
  const regla = {
    nombre: 'Promo',
    canchaId: null,
    diaSemana: null,
    horaDesde: null,
    horaHasta: null,
    requiereSena: false,
    tipoSena: 'PORCENTAJE' as const,
    valorSena: 0,
    minutosExpiracion: 30,
    margenMinAntesInicio: 15,
    prioridad: 50,
    activa: true,
  };

  it('una regla nueva cambia la cotización al instante', async () => {
    await ctx.configuracion.crearRegla(ctx.club.id, regla);
    const cfg = (await ctx.clubs.porId(ctx.club.id))!;
    expect(cotizarTurno(cfg, ctx.canchas.f5a!, ba('2030-01-05', '20:00'))?.montoSena).toBe(0);
  });

  it('valida franja completa y porcentaje', async () => {
    await expect(
      ctx.configuracion.crearRegla(ctx.club.id, { ...regla, horaDesde: '10:00' }),
    ).rejects.toMatchObject({
      codigo: 'FRANJA_INCOMPLETA',
    });
    await expect(
      ctx.configuracion.crearRegla(ctx.club.id, { ...regla, requiereSena: true, valorSena: 120 }),
    ).rejects.toMatchObject({
      codigo: 'PORCENTAJE_INVALIDO',
    });
  });

  it('feriado cerrado y horario reducido', async () => {
    await ctx.configuracion.guardarDiaEspecial(ctx.club.id, '2030-01-05', {
      cerrado: true,
      abre: null,
      cierra: null,
      motivo: 'Año nuevo',
    });
    await expect(
      ctx.configuracion.guardarDiaEspecial(ctx.club.id, '2030-01-06', {
        cerrado: false,
        abre: null,
        cierra: null,
        motivo: null,
      }),
    ).rejects.toMatchObject({ codigo: 'HORARIO_INCOMPLETO' });
    await ctx.configuracion.guardarDiaEspecial(ctx.club.id, '2030-01-05', {
      cerrado: false,
      abre: '14:00',
      cierra: '18:00',
      motivo: 'Medio día',
    });
    expect((await ctx.configuracion.leer(ctx.club.id)).diasEspeciales).toMatchObject([
      { fecha: '2030-01-05', cerrado: false, abre: '14:00', cierra: '18:00' },
    ]);
    await ctx.configuracion.borrarDiaEspecial(ctx.club.id, '2030-01-05');
    expect((await ctx.configuracion.leer(ctx.club.id)).diasEspeciales).toEqual([]);
  });
});

describe('avisos de configuración', () => {
  it('el club demo bien configurado no tiene avisos', async () => {
    expect((await ctx.configuracion.leer(ctx.club.id)).avisos).toEqual([]);
  });

  it('horarios sin tarifa: se avisa por cancha y día, con los rangos', async () => {
    const [valle] = await ctx.db
      .select()
      .from(tarifas)
      .where(and(eq(tarifas.clubId, ctx.club.id), eq(tarifas.horaDesde, '00:00:00')));
    await ctx.configuracion.borrarTarifa(ctx.club.id, valle!.id);
    const avisos = (await ctx.configuracion.leer(ctx.club.id)).avisos.map((a) => a.mensaje);
    expect(avisos).toContain(
      'Cancha 1 · sábados 09:00–18:00, 00:00–02:00 sin precio: esos turnos no se muestran al público.',
    );
    expect(avisos).toContain(
      'Cancha 2 · lunes 10:00–18:00 sin precio: esos turnos no se muestran al público.',
    );
    // La F7 tiene tarifa propia: no aparece.
    expect(avisos.some((a) => a.startsWith('Cancha 3'))).toBe(false);
  });

  it('seña sin ningún medio de pago, y club sin teléfono', async () => {
    const sinMp = await crearContexto({ conMp: false });
    try {
      await sinMp.db
        .update(clubs)
        .set({ datosTransferencia: null, telefono: null })
        .where(eq(clubs.id, sinMp.club.id));
      sinMp.clubs.invalidar();
      expect((await sinMp.configuracion.leer(sinMp.club.id)).avisos).toEqual([
        { nivel: 'error', mensaje: expect.stringContaining('no configuraste Mercado Pago ni transferencia') },
        { nivel: 'advertencia', mensaje: expect.stringContaining('teléfono del club') },
      ]);
    } finally {
      await sinMp.cerrar();
    }
  });
});

describe('usuarios del club', () => {
  it('invitar: cuenta nueva con contraseña generada; una existente solo suma el rol', async () => {
    const nueva = await ctx.configuracion.invitar(ctx.club.id, {
      email: 'Nuevo@Club.Test',
      nombre: 'Nuevo',
      rol: 'RECEPCION',
    });
    expect(nueva.contrasenaGenerada).toMatch(/^[\w-]{12}$/);
    const { token } = await ctx.auth.login('nuevo@club.test', nueva.contrasenaGenerada!);
    expect(await ctx.auth.sesion(token)).not.toBeNull();

    const otro = await crearClubDemo(ctx.db, 'otro-club');
    const enOtro = await ctx.configuracion.invitar(otro.club.id, {
      email: 'nuevo@club.test',
      nombre: 'x',
      rol: 'ADMIN',
    });
    expect(enOtro.contrasenaGenerada).toBeNull();
    await expect(
      ctx.configuracion.invitar(ctx.club.id, { email: 'nuevo@club.test', nombre: 'x', rol: 'ADMIN' }),
    ).rejects.toMatchObject({ codigo: 'YA_ES_MIEMBRO' });
  });

  it('el club nunca se queda sin dueño', async () => {
    await ctx.auth.asignarRol(ctx.club.id, ctx.usuario.id, 'OWNER');
    await expect(ctx.configuracion.cambiarRol(ctx.club.id, ctx.usuario.id, 'ADMIN')).rejects.toMatchObject({
      codigo: 'ULTIMO_DUENO',
    });
    await expect(ctx.configuracion.quitar(ctx.club.id, ctx.usuario.id)).rejects.toMatchObject({
      codigo: 'ULTIMO_DUENO',
    });

    const otro = await ctx.configuracion.invitar(ctx.club.id, {
      email: 'socio@club.test',
      nombre: 'Socio',
      rol: 'OWNER',
    });
    await ctx.configuracion.cambiarRol(ctx.club.id, ctx.usuario.id, 'ADMIN');
    expect((await ctx.configuracion.usuarios(ctx.club.id)).map((u) => [u.nombre, u.rol])).toEqual([
      ['Recepción', 'ADMIN'],
      ['Socio', 'OWNER'],
    ]);
    expect(otro.usuarioId).toBeTruthy();
  });

  it('quitar a alguien sin otros clubs le cierra las sesiones', async () => {
    const r = await ctx.configuracion.invitar(ctx.club.id, {
      email: 'temporal@club.test',
      nombre: 'Temporal',
      rol: 'RECEPCION',
    });
    const { token } = await ctx.auth.login('temporal@club.test', r.contrasenaGenerada!);
    await ctx.configuracion.quitar(ctx.club.id, r.usuarioId);
    expect(await ctx.auth.sesion(token)).toBeNull();
  });

  it('cambiar contraseña: exige la actual y cierra las otras sesiones', async () => {
    const r = await ctx.configuracion.invitar(ctx.club.id, {
      email: 'pepe@club.test',
      nombre: 'Pepe',
      rol: 'ADMIN',
    });
    const a = await ctx.auth.login('pepe@club.test', r.contrasenaGenerada!);
    const b = await ctx.auth.login('pepe@club.test', r.contrasenaGenerada!);
    const sesionA = (await ctx.auth.sesion(a.token))!;
    await expect(
      ctx.auth.cambiarContrasena(r.usuarioId, sesionA.sesionId, 'mal', 'nueva-contrasena-1'),
    ).rejects.toMatchObject({
      codigo: 'CONTRASENA_ACTUAL_INCORRECTA',
    });
    await ctx.auth.cambiarContrasena(
      r.usuarioId,
      sesionA.sesionId,
      r.contrasenaGenerada!,
      'nueva-contrasena-1',
    );
    expect(await ctx.auth.sesion(a.token)).not.toBeNull();
    expect(await ctx.auth.sesion(b.token)).toBeNull();
    expect(await ctx.db.select().from(sesiones).where(eq(sesiones.usuarioId, r.usuarioId))).toHaveLength(1);
    await expect(ctx.auth.login('pepe@club.test', 'nueva-contrasena-1')).resolves.toBeTruthy();
  });
});
