import { notificaciones } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Contexto, crearContexto, iso, panel, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
let recepcion: string;
beforeAll(async () => {
  ctx = await crearContexto();
  recepcion = (await usuarioPanel(ctx, 'RECEPCION')).cookie;
});
afterAll(() => ctx.cerrar());

describe('mensajes a clientes', () => {
  it('lista el texto como lo recibe el cliente, avisa si WhatsApp no está configurado, y reintenta los fallidos', async () => {
    await panel(ctx, recepcion, 'POST', '/turnos', {
      canchaId: ctx.canchas.f5a!.id,
      inicio: iso('2030-01-05', '20:00'),
      cliente: { nombre: 'Mensajera', telefono: '11 5000-3131' },
    });
    const r = (await panel(ctx, recepcion, 'GET', '/mensajes')).json();
    expect(r.whatsappConfigurado).toBe(false);
    expect(r.mensajes).toMatchObject([
      {
        plantilla: 'reserva_confirmada',
        destino: '+5491150003131',
        estado: 'PENDIENTE',
        cliente: 'Mensajera',
        texto: expect.stringMatching(
          /^✅ Turno confirmado en La Canchita F5\. Te esperamos en la Cancha 1 el /,
        ),
      },
    ]);

    const id = r.mensajes[0].id;
    expect((await panel(ctx, recepcion, 'POST', `/mensajes/${id}/reintentar`)).statusCode).toBe(404);
    await ctx.db
      .update(notificaciones)
      .set({ estado: 'FALLIDA', intentos: 6, error: 'WhatsApp 400: template not found' })
      .where(eq(notificaciones.id, id));
    expect((await panel(ctx, recepcion, 'GET', '/mensajes?estado=FALLIDA')).json().mensajes).toMatchObject([
      { id, error: 'WhatsApp 400: template not found' },
    ]);
    expect((await panel(ctx, recepcion, 'POST', `/mensajes/${id}/reintentar`)).statusCode).toBe(204);
    expect((await panel(ctx, recepcion, 'GET', '/mensajes?estado=PENDIENTE')).json().mensajes).toMatchObject([
      { id, intentos: 0, error: null },
    ]);
  });
});
