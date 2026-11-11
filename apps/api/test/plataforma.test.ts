import { VERSION_TERMINOS } from '@cancheria/core';
import { usuarios } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Contexto, crearContexto, iso, pedido, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
let superadmin: string;
let dueno: string;
beforeAll(async () => {
  ctx = await crearContexto({
    abonoMensual: 2_500_000,
    comoPagarAbono: 'Alias: cancheria.abono',
    avisosEmail: 'yo@gmail.com',
  });
  const sa = await usuarioPanel(ctx, 'OWNER');
  await ctx.db.update(usuarios).set({ esSuperadmin: true }).where(eq(usuarios.id, sa.usuario.id));
  superadmin = sa.cookie;
  dueno = (await usuarioPanel(ctx, 'OWNER')).cookie;
});
afterAll(() => ctx.cerrar());

const csrf = { 'x-cancheria-csrf': '1' };
const registrar = (club: Record<string, string>, dueno: Record<string, string>) =>
  ctx.app.inject({
    method: 'POST',
    url: '/admin/registro',
    headers: csrf,
    payload: { club, dueno, aceptaTerminos: true },
  });
const sa = (metodo: 'GET' | 'POST', url: string, payload?: unknown, cookie = superadmin) =>
  ctx.app.inject({
    method: metodo,
    url: `/admin/plataforma${url}`,
    headers: { cookie, ...csrf },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

let nuevo: { clubId: string; cookie: string };

describe('registro de un club', () => {
  it('valida la dirección del club y avisa si está ocupada', async () => {
    const r = (slug: string) => ctx.app.inject({ method: 'GET', url: `/admin/registro/slug?slug=${slug}` });
    expect((await r('el-potrero')).json()).toEqual({ disponible: true, motivo: null });
    expect((await r(ctx.slug)).json()).toMatchObject({ disponible: false });
    expect((await r('panel')).json()).toMatchObject({
      disponible: false,
      motivo: 'Esa dirección está reservada',
    });
    expect((await r('Con Espacios')).json()).toMatchObject({ disponible: false });
  });

  it('sin aceptar los términos no se registra', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/admin/registro',
      headers: csrf,
      payload: {
        club: { nombre: 'Sin Acepto', slug: 'sin-acepto', telefono: '11 5555-0009' },
        dueno: { nombre: 'Ana', email: 'sin-acepto@potrero.test', contrasena: 'una-clave-larga' },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/admin/registro/slug?slug=sin-acepto' })).json(),
    ).toMatchObject({
      disponible: true,
    });
  });

  it('crea el club PENDIENTE con su dueño y deja la sesión abierta', async () => {
    const res = await registrar(
      { nombre: 'El Potrero', slug: 'el-potrero', telefono: '11 5555-0001' },
      { nombre: 'Ana Dueña', email: 'ana@potrero.test', contrasena: 'una-clave-larga' },
    );
    expect(res.statusCode).toBe(201);
    const [u] = await ctx.db.select().from(usuarios).where(eq(usuarios.email, 'ana@potrero.test'));
    expect(u).toMatchObject({ terminosVersion: VERSION_TERMINOS });
    expect(u?.terminosAceptadosEn).toBeInstanceOf(Date);
    // Te llega el aviso por mail para aprobarlo.
    await vi.waitFor(() => expect(ctx.correo.enviados).toHaveLength(1));
    expect(ctx.correo.enviados[0]).toMatchObject({
      para: 'yo@gmail.com',
      asunto: 'Nuevo club para aprobar: El Potrero',
    });
    expect(ctx.correo.enviados[0]?.texto).toContain('Email: ana@potrero.test');
    expect(ctx.correo.enviados[0]?.texto).toContain('https://cancheria.test/panel/plataforma');
    const cookie = res.cookies.find((c) => c.name === 'cancheria_sesion');
    expect(cookie).toBeDefined();
    nuevo = { clubId: res.json().clubId, cookie: `cancheria_sesion=${cookie?.value}` };

    const yo = await ctx.app.inject({
      method: 'GET',
      url: '/admin/auth/yo',
      headers: { cookie: nuevo.cookie },
    });
    expect(yo.json()).toMatchObject({
      usuario: { email: 'ana@potrero.test', esSuperadmin: false },
      // Sin canchas todavía: se cotiza como el plan más chico.
      clubs: [
        {
          id: nuevo.clubId,
          slug: 'el-potrero',
          rol: 'OWNER',
          estado: 'PENDIENTE',
          abonoHasta: null,
          abono: { precio: 3_990_000, plan: 'Chico', canchas: 0 },
        },
      ],
      comoPagarAbono: 'Alias: cancheria.abono',
    });
    // Puede configurar su club mientras espera.
    const config = await ctx.app.inject({
      method: 'GET',
      url: `/admin/clubs/${nuevo.clubId}/config`,
      headers: { cookie: nuevo.cookie },
    });
    expect(config.statusCode).toBe(200);
  });

  it('rechaza un email que ya tiene cuenta y una dirección repetida', async () => {
    const otra = { nombre: 'Otra', telefono: '11 5555-0002' };
    const email = await registrar(
      { ...otra, slug: 'otro-club' },
      { nombre: 'Ana', email: 'ana@potrero.test', contrasena: 'una-clave-larga' },
    );
    expect(email.json().error.codigo).toBe('EMAIL_EN_USO');
    const slug = await registrar(
      { ...otra, slug: 'el-potrero' },
      { nombre: 'Beto', email: 'beto@otro.test', contrasena: 'una-clave-larga' },
    );
    expect(slug.json().error.codigo).toBe('SLUG_EN_USO');
  });

  it('la página pública se ve pero no toma reservas hasta que se aprueba', async () => {
    const club = await ctx.app.inject({ method: 'GET', url: '/public/clubs/el-potrero' });
    expect(club.json()).toMatchObject({ nombre: 'El Potrero', habilitado: false });
    const reserva = await ctx.app.inject({
      method: 'POST',
      url: '/public/clubs/el-potrero/reservas',
      payload: pedido('00000000-0000-0000-0000-000000000000', iso('2030-01-05', '20:00')),
    });
    expect(reserva.statusCode).toBe(403);
    expect(reserva.json().error.codigo).toBe('CLUB_NO_HABILITADO');
  });
});

describe('administración de la plataforma', () => {
  it('solo el superadmin la ve (para el resto no existe)', async () => {
    expect((await sa('GET', '/clubs', undefined, dueno)).statusCode).toBe(404);
    expect((await sa('GET', '/clubs', undefined, nuevo.cookie)).statusCode).toBe(404);
    const lista = await sa('GET', '/clubs');
    expect(lista.statusCode).toBe(200);
    expect(lista.json().clubs.find((c: { id: string }) => c.id === nuevo.clubId)).toMatchObject({
      estado: 'PENDIENTE',
      dueno: { nombre: 'Ana Dueña', email: 'ana@potrero.test' },
      canchas: 0,
    });
  });

  it('aprobar con prueba gratis: habilita reservas y cubre el abono esos días', async () => {
    expect((await sa('POST', `/clubs/${nuevo.clubId}/aprobar`, { diasPrueba: 15 })).statusCode).toBe(204);
    const yo = await ctx.app.inject({
      method: 'GET',
      url: '/admin/auth/yo',
      headers: { cookie: nuevo.cookie },
    });
    // El reloj de los tests es el viernes 4/1/2030: 15 días incluyen hoy.
    expect(yo.json().clubs[0]).toMatchObject({ estado: 'ACTIVO', abonoHasta: '2030-01-18' });
    const club = await ctx.app.inject({ method: 'GET', url: '/public/clubs/el-potrero' });
    expect(club.json().habilitado).toBe(true);
    expect((await sa('POST', `/clubs/${nuevo.clubId}/aprobar`, {})).json().error.codigo).toBe('NO_PENDIENTE');
  });

  it('un pago del abono extiende la cobertura desde el día siguiente al último cubierto', async () => {
    const pago = await sa('POST', `/clubs/${nuevo.clubId}/pagos`, {
      meses: 1,
      monto: 2_500_000,
      medio: 'TRANSFERENCIA',
      nota: 'Enero',
    });
    expect(pago.statusCode).toBe(201);
    expect(pago.json()).toMatchObject({ desde: '2030-01-19', hasta: '2030-02-18', meses: 1 });
    const otro = await sa('POST', `/clubs/${nuevo.clubId}/pagos`, {
      meses: 2,
      monto: 5_000_000,
      medio: 'EFECTIVO',
    });
    expect(otro.json()).toMatchObject({ desde: '2030-02-19', hasta: '2030-04-18' });
    const pagos = await sa('GET', `/clubs/${nuevo.clubId}/pagos`);
    expect(pagos.json()).toHaveLength(2);
  });

  it('suspender corta las reservas y reactivar las devuelve', async () => {
    expect(
      (await sa('POST', `/clubs/${nuevo.clubId}/suspender`, { motivo: 'Abono impago' })).statusCode,
    ).toBe(204);
    const club = await ctx.app.inject({ method: 'GET', url: '/public/clubs/el-potrero' });
    expect(club.json().habilitado).toBe(false);
    const yo = await ctx.app.inject({
      method: 'GET',
      url: '/admin/auth/yo',
      headers: { cookie: nuevo.cookie },
    });
    expect(yo.json().clubs[0]).toMatchObject({ estado: 'SUSPENDIDO', motivoSuspension: 'Abono impago' });

    expect((await sa('POST', `/clubs/${nuevo.clubId}/reactivar`)).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: '/public/clubs/el-potrero' })).json().habilitado).toBe(
      true,
    );
  });
});

describe('GET /public/plataforma', () => {
  it('precio del abono y días de prueba para la página de venta', async () => {
    const res = await ctx.app.inject('/public/plataforma');
    expect(res.json()).toEqual({
      planes: [
        { nombre: 'Chico', desdeCanchas: 1, precio: 3_990_000 },
        { nombre: 'Mediano', desdeCanchas: 4, precio: 5_990_000 },
        { nombre: 'Grande', desdeCanchas: 7, precio: 7_990_000 },
      ],
      diasPrueba: 15,
    });
  });
});

describe('planes y precios especiales (superadmin)', () => {
  it('edita los planes y le da un precio especial a un club; el dueño lo ve en su sesión', async () => {
    const planes = await sa('GET', '/planes');
    expect(planes.json()).toHaveLength(3);
    const especial = await ctx.app.inject({
      method: 'PUT',
      url: `/admin/plataforma/clubs/${ctx.club.id}/precio-especial`,
      headers: { cookie: superadmin, 'x-cancheria-csrf': '1' },
      payload: { descuentoPct: 40, hasta: '2031-01-31', motivo: 'Fundador' },
    });
    expect(especial.statusCode).toBe(204);
    const lista = (await sa('GET', '/clubs')).json().clubs;
    expect(lista.find((c: { id: string }) => c.id === ctx.club.id).abono).toMatchObject({
      plan: { nombre: 'Chico' },
      precioLista: 3_990_000,
      precio: 2_394_000,
      especial: { descuentoPct: 40, motivo: 'Fundador' },
    });
    const yo = await ctx.app.inject({ method: 'GET', url: '/admin/auth/yo', headers: { cookie: dueno } });
    expect(yo.json().clubs[0].abono).toEqual({ precio: 2_394_000, plan: 'Chico', canchas: 3 });

    // Un club no superadmin no puede tocar los planes.
    const ajeno = await ctx.app.inject({
      method: 'PUT',
      url: '/admin/plataforma/planes',
      headers: { cookie: dueno, 'x-cancheria-csrf': '1' },
      payload: { planes: [{ nombre: 'Gratis', desdeCanchas: 1, precio: 0 }] },
    });
    expect(ajeno.statusCode).toBe(404);
  });
});
