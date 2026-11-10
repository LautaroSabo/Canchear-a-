import { clubs, turnos } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ba, type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
beforeEach(async () => {
  ctx = await crearContexto();
  return () => ctx.cerrar();
});

/** Turno confirmado (con email salvo que se diga otra cosa), reservado el `creado`. */
async function confirmado(
  inicio: Date,
  { creado = ba('2030-01-01', '10:00'), email = true, cancha = ctx.canchas.f5a! } = {},
) {
  const t = await ctx.hold(cancha, inicio);
  await ctx.db
    .update(turnos)
    .set({ estado: 'CONFIRMADO', expiraEn: null, creadoEn: creado, ...(email ? {} : { emailAviso: null }) })
    .where(eq(turnos.id, t.id));
  return t;
}
const recordatorios = () => ctx.mensajes('recordatorio_turno');

describe('recordatorio antes del partido', () => {
  // Ahora: viernes 2030-01-04 12:00. Por defecto, 3 horas antes.
  it('sale una vez, por mail, cuando faltan 3 horas o menos', async () => {
    const pronto = await confirmado(ba('2030-01-04', '14:00'));
    const despues = await confirmado(ba('2030-01-04', '17:00'));
    expect(await ctx.recordatorios.enviar()).toEqual({ enviados: 1, salteados: 0 });
    const [m] = await recordatorios();
    expect(m).toMatchObject({ canal: 'EMAIL', destino: pronto.emailAviso });
    expect(m?.payload).toMatchObject({ hora: '14:00', link: expect.stringContaining(pronto.codigoCheckin) });

    // Otra vuelta: no se repite.
    expect(await ctx.recordatorios.enviar()).toEqual({ enviados: 0, salteados: 0 });
    // A las 14:30 le toca al de las 17:00.
    ctx.setAhora(ba('2030-01-04', '14:30'));
    expect(await ctx.recordatorios.enviar()).toEqual({ enviados: 1, salteados: 0 });
    expect((await recordatorios()).map((r) => r.destino)).toEqual([pronto.emailAviso, despues.emailAviso]);
  });

  it('no sale si reservó cuando ya faltaba poco, si no dejó email, o si se canceló', async () => {
    await confirmado(ba('2030-01-04', '14:00'), { creado: ba('2030-01-04', '11:30') });
    await confirmado(ba('2030-01-04', '14:00'), { email: false, cancha: ctx.canchas.f5b! });
    const cancelado = await confirmado(ba('2030-01-04', '15:00'));
    await ctx.db.update(turnos).set({ estado: 'CANCELADO' }).where(eq(turnos.id, cancelado.id));
    expect(await ctx.recordatorios.enviar()).toEqual({ enviados: 0, salteados: 2 });
    expect(await recordatorios()).toHaveLength(0);
  });

  it('el club lo puede apagar (0) o mandarlo con más anticipación', async () => {
    await confirmado(ba('2030-01-04', '20:00'));
    await ctx.db.update(clubs).set({ horasRecordatorio: 0 }).where(eq(clubs.id, ctx.club.id));
    expect(await ctx.recordatorios.enviar()).toEqual({ enviados: 0, salteados: 0 });
    await ctx.db.update(clubs).set({ horasRecordatorio: 24 }).where(eq(clubs.id, ctx.club.id));
    expect(await ctx.recordatorios.enviar()).toEqual({ enviados: 1, salteados: 0 });
  });

  it('dos workers a la vez no lo mandan dos veces', async () => {
    await confirmado(ba('2030-01-04', '14:00'));
    await Promise.all([ctx.recordatorios.enviar(), ctx.recordatorios.enviar(), ctx.recordatorios.enviar()]);
    expect(await recordatorios()).toHaveLength(1);
  });
});
