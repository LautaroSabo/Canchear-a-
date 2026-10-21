import { listaEspera } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ba, type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
beforeEach(async () => {
  ctx = await crearContexto();
  return () => ctx.cerrar();
});

const SENA = 2_250_000;
const inscribir = async (telefono: string, desde = '19:00', hasta = '23:00', extra = {}) => {
  const cfg = (await ctx.clubs.porId(ctx.club.id))!;
  return ctx.listaEspera.inscribir(cfg, {
    cliente: { nombre: `Espera ${telefono.slice(-2)}`, telefono },
    desde: ba('2030-01-05', desde),
    hasta: ba('2030-01-05', hasta),
    jugadoresPorLado: 5,
    ...extra,
  });
};
const inscripcion = async (id: string) =>
  (await ctx.db.select().from(listaEspera).where(eq(listaEspera.id, id)))[0]!;

describe('barrido de expiración', () => {
  it('expira solo lo vencido, avisa al cliente y cierra el checkout impago', async () => {
    const vencido = await ctx.hold();
    await ctx.pagos.checkoutMp(vencido.codigoCheckin);
    const vigente = await ctx.hold(ctx.canchas.f5b, ba('2030-01-05', '20:00'), undefined, 30);
    ctx.avanzar(11);

    expect(await ctx.expiracion.barrer()).toEqual({ conciliados: 0, expirados: 1, ofertas: 0 });
    expect((await ctx.turno(vencido.id)).estado).toBe('EXPIRADO');
    expect((await ctx.turno(vigente.id)).estado).toBe('PRE_RESERVADO');
    expect((await ctx.pagosDe(vencido.id))[0]?.estado).toBe('RECHAZADO');
    expect(await ctx.mensajes('reserva_expirada')).toHaveLength(1);
    expect(await ctx.expiracion.barrer()).toEqual({ conciliados: 0, expirados: 0, ofertas: 0 });
  });

  it('webhook perdido: antes de expirar concilia con MP y confirma el turno pagado', async () => {
    const t = await ctx.hold();
    await ctx.pagos.checkoutMp(t.codigoCheckin);
    ctx.pasarela.pagar(t.id, SENA); // el cliente pagó pero el webhook nunca llegó
    ctx.avanzar(11);

    expect(await ctx.expiracion.barrer()).toEqual({ conciliados: 1, expirados: 0, ofertas: 0 });
    expect((await ctx.turno(t.id)).estado).toBe('CONFIRMADO');
  });
});

describe('lista de espera', () => {
  it('el turno liberado se le guarda al primero de la lista, con su propio timer', async () => {
    const original = await ctx.hold();
    const primero = await inscribir('+5491170000001');
    const segundo = await inscribir('+5491170000002');
    ctx.avanzar(11);

    expect((await ctx.expiracion.barrer()).ofertas).toBe(1);
    const i1 = await inscripcion(primero.id);
    expect(i1).toMatchObject({ estado: 'NOTIFICADA' });
    expect((await inscripcion(segundo.id)).estado).toBe('ACTIVA');

    const oferta = await ctx.turno(i1.ofertaTurnoId!);
    expect(oferta).toMatchObject({
      estado: 'PRE_RESERVADO',
      inicio: original.inicio,
      canchaId: original.canchaId,
      montoSena: SENA,
      expiraEn: new Date(ctx.ahora().getTime() + 10 * 60_000),
    });
    const [msg] = await ctx.mensajes('oferta_lista_espera');
    expect(msg).toMatchObject({ destino: '+5491170000001' });
    expect(msg?.payload).toMatchObject({
      cancha: 'Cancha 1',
      hora: '20:00',
      link: `https://cancheria.test/r/${oferta.codigoCheckin}`,
    });
  });

  it('si el primero no paga, la oferta pasa al siguiente', async () => {
    await ctx.hold();
    const primero = await inscribir('+5491170000001');
    const segundo = await inscribir('+5491170000002');
    ctx.avanzar(11);
    await ctx.expiracion.barrer();
    ctx.avanzar(11);
    await ctx.expiracion.barrer();

    expect((await inscripcion(primero.id)).estado).toBe('VENCIDA');
    expect((await inscripcion(segundo.id)).estado).toBe('NOTIFICADA');
  });

  it('si paga, la inscripción queda CONVERTIDA', async () => {
    await ctx.hold();
    const primero = await inscribir('+5491170000001');
    ctx.avanzar(11);
    await ctx.expiracion.barrer();
    const oferta = (await inscripcion(primero.id)).ofertaTurnoId!;
    await ctx.pagos.procesarPagoMp(ctx.club.id, ctx.pasarela.pagar(oferta, SENA));
    expect((await inscripcion(primero.id)).estado).toBe('CONVERTIDA');
    expect((await ctx.turno(oferta)).estado).toBe('CONFIRMADO');
  });

  it('ofertas sin seña (siesta): se confirman con un clic', async () => {
    await ctx.hold(ctx.canchas.f5a, ba('2030-01-07', '14:00')); // lunes 14 hs, sin seña
    const cfg = (await ctx.clubs.porId(ctx.club.id))!;
    const i = await ctx.listaEspera.inscribir(cfg, {
      cliente: { nombre: 'Siesta', telefono: '+5491170000009' },
      desde: ba('2030-01-07', '13:00'),
      hasta: ba('2030-01-07', '17:00'),
    });
    ctx.avanzar(11);
    await ctx.expiracion.barrer();
    const oferta = await ctx.turno((await inscripcion(i.id)).ofertaTurnoId!);
    expect(oferta).toMatchObject({ estado: 'PRE_RESERVADO', montoSena: 0 });
    await ctx.pagos.confirmarSinSena(oferta.codigoCheckin);
    expect((await ctx.turno(oferta.id)).estado).toBe('CONFIRMADO');
  });

  it('no le ofrece el turno a quien lo dejó vencer, ni a quien no le sirve la franja o la cancha', async () => {
    const quienVencio = await ctx.cliente('+5491170000005');
    await ctx.hold(ctx.canchas.f5a, ba('2030-01-05', '20:00'), quienVencio.id);
    await inscribir('+5491170000005');
    await inscribir('+5491170000006', '21:00', '23:00');
    await inscribir('+5491170000007', '19:00', '23:00', { jugadoresPorLado: 7 });
    ctx.avanzar(11);
    expect((await ctx.expiracion.barrer()).ofertas).toBe(0);
  });

  it('turno inminente: no hay tiempo de ofrecerlo, queda libre al público', async () => {
    // Vence a las 19:42; a las 19:43 la oferta tendría que vencer antes de 19:45
    // (inicio − 15 min de margen): quedan 2 min, menos que el mínimo de 3.
    ctx.setAhora(ba('2030-01-05', '19:40'));
    await ctx.hold(ctx.canchas.f5a, ba('2030-01-05', '20:00'), undefined, 2);
    await inscribir('+5491170000001');
    ctx.avanzar(3);
    expect((await ctx.expiracion.barrer()).ofertas).toBe(0);
  });

  it('con algo de margen sí se ofrece, con el timer recortado al margen previo al inicio', async () => {
    ctx.setAhora(ba('2030-01-05', '19:20'));
    await ctx.hold();
    const i = await inscribir('+5491170000001');
    ctx.avanzar(11); // 19:31 → la oferta vence a las 19:41 (timer de 10 min, antes de 19:45)
    expect((await ctx.expiracion.barrer()).ofertas).toBe(1);
    const oferta = await ctx.turno((await inscripcion(i.id)).ofertaTurnoId!);
    expect(oferta.expiraEn).toEqual(ba('2030-01-05', '19:41'));
  });

  it('no permite anotarse dos veces en franjas que se pisan', async () => {
    await inscribir('+5491170000001');
    await expect(inscribir('+5491170000001', '20:00', '22:00')).rejects.toMatchObject({
      codigo: 'YA_EN_LISTA',
    });
  });

  it('vence las inscripciones cuya franja ya pasó', async () => {
    const i = await inscribir('+5491170000001');
    ctx.setAhora(ba('2030-01-06', '00:00'));
    expect(await ctx.listaEspera.vencerViejas()).toBeGreaterThanOrEqual(1);
    expect((await inscripcion(i.id)).estado).toBe('VENCIDA');
  });
});
