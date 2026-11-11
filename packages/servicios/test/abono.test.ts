import { clubs, miembrosClub, pagosAbono } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ServicioAbono } from '../src/abono.ts';
import { PasarelaSuscripcionesFalsa } from '../src/mercadopago/suscripciones.ts';
import { ServicioPlataforma } from '../src/plataforma.ts';
import { ba, type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
let pasarela: PasarelaSuscripcionesFalsa;
let plataforma: ServicioPlataforma;
let abono: ServicioAbono;
const ABONO = 2_500_000;
beforeEach(async () => {
  ctx = await crearContexto();
  pasarela = new PasarelaSuscripcionesFalsa();
  const entorno = { db: ctx.db, reloj: ctx.ahora, urlWeb: 'https://cancheria.test' };
  plataforma = new ServicioPlataforma(entorno);
  abono = new ServicioAbono({
    ...entorno,
    plataforma,
    pasarela,
    token: 'TOKEN-PLATAFORMA',
    abonoMensual: ABONO,
  });
  await ctx.db.insert(miembrosClub).values({ clubId: ctx.club.id, usuarioId: ctx.usuario.id, rol: 'OWNER' });
  return () => ctx.cerrar();
});
const club = async () => (await ctx.db.select().from(clubs).where(eq(clubs.id, ctx.club.id)))[0]!;
const setAbonoHasta = (fecha: string | null) =>
  ctx.db.update(clubs).set({ abonoHasta: fecha }).where(eq(clubs.id, ctx.club.id));

describe('cobro automático del abono', () => {
  // Hoy: viernes 2030-01-04.
  it('crea la suscripción con el primer débito al terminar los días ya pagos', async () => {
    await setAbonoHasta('2030-01-15');
    const r = await abono.iniciar(ctx.club.id, 'Duenio@Club.test');
    expect(r.urlCheckout).toMatch(/^https:\/\/mp\.test\/suscripcion\//);
    const [s] = [...pasarela.suscripciones.values()];
    expect(s?.datos).toMatchObject({
      email: 'duenio@club.test',
      monto: ABONO,
      referenciaExterna: ctx.club.id,
      inicio: ba('2030-01-16', '10:00'),
      urlRetorno: `https://cancheria.test/panel/${ctx.club.id}/cuenta?abono=listo`,
    });
    expect(await club()).toMatchObject({
      mpSuscripcionEstado: 'pending',
      mpSuscripcionEmail: 'duenio@club.test',
    });
    expect((await abono.estado(ctx.club.id)).emailDueno).toBe(ctx.usuario.email);
  });

  it('autorizada y cobrada: extiende el abono un mes una sola vez aunque el aviso se repita', async () => {
    await setAbonoHasta('2030-01-15');
    await abono.iniciar(ctx.club.id, 'duenio@club.test');
    const [s] = [...pasarela.suscripciones.values()];
    pasarela.autorizar(s!.id);
    expect(await abono.procesarNotificacion('subscription_preapproval', s!.id)).toMatchObject({
      estado: 'authorized',
    });
    expect((await club()).mpSuscripcionEstado).toBe('authorized');
    await expect(abono.iniciar(ctx.club.id, 'x@y.test')).rejects.toMatchObject({ codigo: 'YA_SUSCRIPTO' });

    const cobro = pasarela.cobrar(s!.id);
    expect(await abono.procesarNotificacion('subscription_authorized_payment', cobro)).toEqual({
      tipo: 'ABONO_PAGADO',
    });
    expect(await abono.procesarNotificacion('subscription_authorized_payment', cobro)).toEqual({
      tipo: 'YA_REGISTRADO',
    });
    expect((await club()).abonoHasta).toBe('2030-02-15');
    const pagos = await ctx.db.select().from(pagosAbono).where(eq(pagosAbono.clubId, ctx.club.id));
    expect(pagos).toHaveLength(1);
    expect(pagos[0]).toMatchObject({ monto: ABONO, medio: 'MERCADO_PAGO', registradoPor: null });
  });

  it('un cobro rechazado no extiende nada', async () => {
    await abono.iniciar(ctx.club.id, 'duenio@club.test');
    const [s] = [...pasarela.suscripciones.values()];
    const cobro = pasarela.cobrar(s!.id, 'rejected');
    expect(await abono.procesarNotificacion('subscription_authorized_payment', cobro)).toMatchObject({
      tipo: 'COBRO_NO_APROBADO',
    });
    expect((await club()).abonoHasta).toBeNull();
  });

  it('vencido hace más de los días de gracia: se suspende solo y vuelve con el pago', async () => {
    await setAbonoHasta('2029-12-28'); // 7 días vencido
    expect(await plataforma.suspenderVencidos(5)).toHaveLength(1);
    expect(await club()).toMatchObject({
      estado: 'SUSPENDIDO',
      suspendidoPorAbono: true,
      motivoSuspension: 'El abono venció el 28/12/2029. Pagalo para volver a tomar reservas.',
    });
    // Otra vuelta no hace nada.
    expect(await plataforma.suspenderVencidos(5)).toHaveLength(0);

    await abono.iniciar(ctx.club.id, 'duenio@club.test');
    const [s] = [...pasarela.suscripciones.values()];
    await abono.procesarNotificacion('subscription_authorized_payment', pasarela.cobrar(s!.id));
    expect(await club()).toMatchObject({
      estado: 'ACTIVO',
      suspendidoPorAbono: false,
      motivoSuspension: null,
      abonoHasta: '2030-02-03',
    });
  });

  it('dentro de los días de gracia no se suspende; una suspensión manual no se levanta sola', async () => {
    await setAbonoHasta('2030-01-01');
    expect(await plataforma.suspenderVencidos(5)).toHaveLength(0);
    await plataforma.suspender(ctx.club.id, 'Uso indebido');
    await plataforma.registrarPago(ctx.club.id, null, {
      meses: 1,
      monto: ABONO,
      medio: 'MERCADO_PAGO',
      mpPagoId: 'p1',
    });
    expect((await club()).estado).toBe('SUSPENDIDO');
  });

  it('sin token de la plataforma el pago automático no está disponible', async () => {
    const sin = new ServicioAbono({
      db: ctx.db,
      reloj: ctx.ahora,
      urlWeb: 'https://cancheria.test',
      plataforma,
      pasarela,
      token: null,
      abonoMensual: ABONO,
    });
    expect((await sin.estado(ctx.club.id)).cobroAutomatico).toBe(false);
    await expect(sin.iniciar(ctx.club.id, 'x@y.test')).rejects.toMatchObject({
      codigo: 'COBRO_AUTOMATICO_APAGADO',
    });
  });
});
