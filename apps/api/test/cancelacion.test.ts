import { clubs, reembolsos } from '@cancheria/db/schema';
import { firmarWebhook } from '@cancheria/servicios/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AHORA,
  type Contexto,
  crearContexto,
  iso,
  panel,
  pedido,
  reservar,
  usuarioPanel,
} from './helpers.ts';

// El reloj de los tests es el viernes 4/1/2030 a las 12:00 (Buenos Aires).
let ctx: Contexto;
let dueno: string;
beforeAll(async () => {
  ctx = await crearContexto();
  dueno = (await usuarioPanel(ctx, 'OWNER')).cookie;
});
afterEach(() => ctx.setAhora(AHORA));
afterAll(() => ctx.cerrar());

const reservaPaga = async (fecha: string, hora: string) => {
  const { codigo, montoSena } = (await reservar(ctx, pedido(ctx.canchas.f5a.id, iso(fecha, hora)))).json();
  await ctx.app.inject({ method: 'POST', url: `/public/reservas/${codigo}/mercadopago` });
  const turnoId = [...ctx.pasarela.preferencias.values()].at(-1)?.referenciaExterna as string;
  const pago = ctx.pasarela.pagar(turnoId, montoSena);
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/webhooks/mercadopago/${ctx.slug}?data.id=${pago.id}&type=payment`,
    headers: { 'x-request-id': 'r1', 'x-signature': firmarWebhook('secreto-webhook', pago.id, 'r1') },
    payload: { type: 'payment', data: { id: pago.id } },
  });
  expect(res.json().resultado).toBe('CONFIRMADO');
  return { codigo: codigo as string, sena: montoSena as number };
};
const cancelar = (codigo: string) =>
  ctx.app.inject({ method: 'POST', url: `/public/reservas/${codigo}/cancelar` });
const comprobante = async (codigo: string) => (await ctx.app.inject(`/public/reservas/${codigo}`)).json();

describe('el jugador cancela su reserva', () => {
  it('dentro del plazo (24 h por defecto): cancela y se le devuelve la seña', async () => {
    const { codigo, sena } = await reservaPaga('2030-01-06', '20:00');
    expect((await comprobante(codigo)).cancelacion).toEqual({
      permitida: true,
      hasta: iso('2030-01-05', '20:00'),
    });

    const res = await cancelar(codigo);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ estado: 'CANCELADO', senaADevolver: sena });
    expect(res.json().cancelacion).toEqual({ permitida: false, hasta: null });
    const [r] = await ctx.db.select().from(reembolsos).where(eq(reembolsos.clubId, ctx.club.id));
    expect(r).toMatchObject({ motivo: 'TURNO_CANCELADO', estado: 'PENDIENTE' });

    // El horario vuelve a estar libre.
    const grilla = await ctx.app.inject(
      `/public/clubs/${ctx.slug}/disponibilidad?fecha=2030-01-06&jugadores=5`,
    );
    const slot = grilla
      .json()
      .canchas[0].slots.find((s: { inicio: string }) => s.inicio === iso('2030-01-06', '20:00'));
    expect(slot.estado).toBe('LIBRE');
  });

  it('pasado el plazo no puede cancelar online', async () => {
    const { codigo } = await reservaPaga('2030-01-05', '10:00'); // faltan 22 h
    expect((await comprobante(codigo)).cancelacion).toEqual({
      permitida: false,
      hasta: iso('2030-01-04', '10:00'),
    });
    const res = await cancelar(codigo);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('FUERA_DE_PLAZO');
    expect((await comprobante(codigo)).estado).toBe('CONFIRMADO');
  });

  it('el club elige las horas en su configuración; con 0 no se cancela online', async () => {
    const guardar = await panel(ctx, dueno, 'PATCH', '/config/club', { horasCancelacion: 48 });
    expect(guardar.statusCode).toBeLessThan(300);
    const [c] = await ctx.db
      .select({ h: clubs.horasCancelacion })
      .from(clubs)
      .where(eq(clubs.id, ctx.club.id));
    expect(c?.h).toBe(48);
    const { codigo } = await reservaPaga('2030-01-06', '18:00'); // faltan 54 h
    expect((await comprobante(codigo)).cancelacion.hasta).toBe(iso('2030-01-04', '18:00'));

    await panel(ctx, dueno, 'PATCH', '/config/club', { horasCancelacion: 0 });
    expect((await comprobante(codigo)).cancelacion).toEqual({ permitida: false, hasta: null });
    const res = await cancelar(codigo);
    expect(res.json().error.codigo).toBe('CANCELACION_NO_DISPONIBLE');
  });

  it('un código que no existe da 404', async () => {
    const res = await cancelar('0'.repeat(32));
    expect(res.statusCode).toBe(404);
  });
});
