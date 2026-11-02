// Seguridad: el personal de un club no puede ver ni tocar nada de otro club cambiando
// IDs en la URL. Se arma un segundo club con datos reales y el dueño del primero intenta
// cada operación con los IDs del segundo, por la ruta de su propio club.
import { crearClubDemo } from '@cancheria/db';
import {
  clientes,
  configuracionExpiracion,
  inventarioCantina,
  notificaciones,
  pagos,
  tarifas,
} from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Contexto, crearContexto, iso, multipart, PNG, panel, pedido, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
let duenoA: string;
const b: Record<string, string> = {};

beforeAll(async () => {
  ctx = await crearContexto();
  duenoA = (await usuarioPanel(ctx, 'OWNER')).cookie;

  // Club B, con un turno reservado y una transferencia subida.
  const otro = await crearClubDemo(ctx.db, 'club-b-aislamiento');
  b.clubId = otro.club.id;
  b.canchaId = otro.canchas[0]?.id as string;
  const reserva = await ctx.app.inject({
    method: 'POST',
    url: '/public/clubs/club-b-aislamiento/reservas',
    payload: pedido(b.canchaId, iso('2030-01-05', '21:00')),
  });
  expect(reserva.statusCode).toBe(201);
  b.codigo = reserva.json().codigo;
  const subida = await ctx.app.inject({
    method: 'POST',
    url: `/public/reservas/${b.codigo}/transferencia`,
    ...multipart('comprobante', 'c.png', 'image/png', PNG),
  });
  expect(subida.statusCode).toBe(201);
  const duenoB = await usuarioPanel(ctx, 'RECEPCION', b.clubId);
  b.usuarioId = duenoB.usuario.id;

  const [pago] = await ctx.db.select().from(pagos).where(eq(pagos.clubId, b.clubId));
  const [cliente] = await ctx.db.select().from(clientes).where(eq(clientes.clubId, b.clubId));
  const [producto] = await ctx.db
    .select()
    .from(inventarioCantina)
    .where(eq(inventarioCantina.clubId, b.clubId));
  const [tarifa] = await ctx.db.select().from(tarifas).where(eq(tarifas.clubId, b.clubId));
  const [regla] = await ctx.db
    .select()
    .from(configuracionExpiracion)
    .where(eq(configuracionExpiracion.clubId, b.clubId));
  const [mensaje] = await ctx.db
    .insert(notificaciones)
    .values({
      clubId: b.clubId,
      canal: 'WHATSAPP',
      destino: '+5491150000000',
      plantilla: 'reserva_confirmada',
      estado: 'FALLIDA',
    })
    .returning();
  b.turnoId = pago?.turnoId as string;
  b.pagoId = pago?.id as string;
  b.clienteId = cliente?.id as string;
  b.productoId = producto?.id as string;
  b.tarifaId = tarifa?.id as string;
  b.reglaId = regla?.id as string;
  b.mensajeId = mensaje?.id as string;
  for (const [k, v] of Object.entries(b)) expect(v, k).toBeTruthy();
});
afterAll(() => ctx.cerrar());

describe('aislamiento entre clubes', () => {
  it('con los IDs de otro club, todo responde como si no existieran', async () => {
    const intentos: [string, 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string, unknown?][] = [
      ['ver turno', 'GET', `/turnos/${b.turnoId}`],
      ['cancelar turno', 'POST', `/turnos/${b.turnoId}/cancelar`, { motivo: 'ataque', devolverSena: false }],
      ['marcar ausente', 'POST', `/turnos/${b.turnoId}/ausente`],
      [
        'cobrar turno',
        'POST',
        `/turnos/${b.turnoId}/pagos`,
        { monto: 100, medio: 'EFECTIVO', concepto: 'SALDO' },
      ],
      ['ver comprobante', 'GET', `/pagos/${b.pagoId}/comprobante`],
      ['aprobar transferencia', 'POST', `/pagos/${b.pagoId}/aprobar`],
      ['rechazar transferencia', 'POST', `/pagos/${b.pagoId}/rechazar`, { motivo: 'ataque' }],
      ['ver cliente', 'GET', `/clientes/${b.clienteId}`],
      [
        'ajustar puntos',
        'POST',
        `/clientes/${b.clienteId}/ajuste-puntos`,
        { puntos: 1000, motivo: 'ataque' },
      ],
      ['editar producto', 'PATCH', `/cantina/productos/${b.productoId}`, { precio: 1 }],
      ['reponer stock', 'POST', `/cantina/productos/${b.productoId}/reposicion`, { cantidad: 5 }],
      ['editar cancha', 'PATCH', `/config/canchas/${b.canchaId}`, { nombre: 'Hackeada' }],
      ['borrar tarifa', 'DELETE', `/config/tarifas/${b.tarifaId}`],
      ['borrar regla', 'DELETE', `/config/reglas/${b.reglaId}`],
      ['cambiar rol', 'PATCH', `/config/usuarios/${b.usuarioId}`, { rol: 'OWNER' }],
      ['sacar usuario', 'DELETE', `/config/usuarios/${b.usuarioId}`],
      ['reintentar mensaje', 'POST', `/mensajes/${b.mensajeId}/reintentar`],
    ];
    const filtraciones: string[] = [];
    for (const [nombre, metodo, ruta, cuerpo] of intentos) {
      const res = await panel(ctx, duenoA, metodo, ruta, cuerpo);
      if (res.statusCode < 400 || ![404, 422, 409].includes(res.statusCode)) {
        filtraciones.push(`${nombre}: ${res.statusCode} ${res.body.slice(0, 120)}`);
      }
    }
    expect(filtraciones).toEqual([]);
  });

  it('nada del club B cambió', async () => {
    const reserva = await ctx.app.inject({ method: 'GET', url: `/public/reservas/${b.codigo}` });
    expect(reserva.json()).toMatchObject({ estado: 'PRE_RESERVADO', senaEnRevision: true });
    const [pago] = await ctx.db
      .select()
      .from(pagos)
      .where(eq(pagos.id, b.pagoId as string));
    expect(pago?.estado).toBe('EN_REVISION');
  });

  it('tampoco entra por la ruta del otro club', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/admin/clubs/${b.clubId}/agenda?fecha=2030-01-05`,
      headers: { cookie: duenoA },
    });
    expect(res.statusCode).toBe(404);
  });
});
