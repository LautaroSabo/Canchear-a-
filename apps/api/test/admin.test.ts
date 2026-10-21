import { randomUUID } from 'node:crypto';
import { crearClubDemo } from '@cancheria/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AHORA,
  type Contexto,
  crearContexto,
  iso,
  multipart,
  PNG,
  panel,
  pedido,
  reservar,
  usuarioPanel,
} from './helpers.ts';

let ctx: Contexto;
let owner: string;
let admin: string;
let recepcion: string;
beforeAll(async () => {
  ctx = await crearContexto();
  owner = (await usuarioPanel(ctx, 'OWNER')).cookie;
  admin = (await usuarioPanel(ctx, 'ADMIN')).cookie;
  recepcion = (await usuarioPanel(ctx, 'RECEPCION')).cookie;
});
afterEach(() => ctx.setAhora(AHORA));
afterAll(() => ctx.cerrar());

const login = (payload: unknown, headers: Record<string, string> = { 'x-cancheria-csrf': '1' }) =>
  ctx.app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    headers,
    payload: payload as Record<string, string>,
  });

describe('sesión', () => {
  it('login: cookie httpOnly + SameSite=Lax limitada a /admin, y devuelve los clubs con el rol', async () => {
    const { email } = await usuarioPanel(ctx, 'RECEPCION');
    const res = await login({ email, contrasena: 'contrasena-de-prueba' });
    expect(res.statusCode).toBe(200);
    expect(res.json().clubs).toEqual([
      { id: ctx.club.id, slug: ctx.slug, nombre: 'La Canchita F5', rol: 'RECEPCION' },
    ]);
    const c = res.cookies.find((x) => x.name === 'cancheria_sesion');
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/admin' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('fuerza bruta: pasado el límite de intentos por minuto responde 429', async () => {
    const limitado = await crearContexto({ loginsPorMinuto: 3 });
    try {
      const intento = () =>
        limitado.app.inject({
          method: 'POST',
          url: '/admin/auth/login',
          headers: { 'x-cancheria-csrf': '1' },
          payload: { email: 'alguien@club.test', contrasena: 'probando' },
        });
      const codigos = [];
      for (let i = 0; i < 4; i++) codigos.push((await intento()).statusCode);
      expect(codigos).toEqual([401, 401, 401, 429]);
    } finally {
      await limitado.cerrar();
    }
  });

  it('JSON mal formado → 400 SOLICITUD_INVALIDA', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      headers: { 'x-cancheria-csrf': '1', 'content-type': 'application/json' },
      payload: '{"email":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.codigo).toBe('SOLICITUD_INVALIDA');
  });

  it('credenciales inválidas → 401; sin header CSRF → 403', async () => {
    expect((await login({ email: 'nadie@club.test', contrasena: 'x' })).json().error.codigo).toBe(
      'CREDENCIALES_INVALIDAS',
    );
    const sinCsrf = await login({ email: 'nadie@club.test', contrasena: 'x' }, {});
    expect(sinCsrf.statusCode).toBe(403);
    expect(sinCsrf.json().error.codigo).toBe('CSRF');
  });

  it('logout funciona aunque el front mande content-type JSON sin cuerpo (como fetch con headers fijos)', async () => {
    const { cookie } = await usuarioPanel(ctx, 'RECEPCION');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/admin/auth/logout',
      headers: { cookie, 'x-cancheria-csrf': '1', 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(204);
    expect((await ctx.app.inject({ url: '/admin/auth/yo', headers: { cookie } })).statusCode).toBe(401);
  });

  it('/auth/yo con y sin sesión; logout invalida la cookie', async () => {
    const { cookie } = await usuarioPanel(ctx, 'ADMIN');
    const yo = await ctx.app.inject({ url: '/admin/auth/yo', headers: { cookie } });
    expect(yo.json().clubs[0].rol).toBe('ADMIN');
    await ctx.app.inject({
      method: 'POST',
      url: '/admin/auth/logout',
      headers: { cookie, 'x-cancheria-csrf': '1' },
    });
    expect((await ctx.app.inject({ url: '/admin/auth/yo', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('permisos', () => {
  it('sin sesión 401; miembro de otro club 404; rol insuficiente 403', async () => {
    expect((await ctx.app.inject(`/admin/clubs/${ctx.club.id}/agenda?fecha=2030-01-05`)).statusCode).toBe(
      401,
    );

    const otro = await crearClubDemo(ctx.db, `otro-${randomUUID().slice(0, 8)}`);
    const ajeno = await usuarioPanel(ctx, 'OWNER', otro.club.id);
    const res = await panel(ctx, ajeno.cookie, 'GET', '/agenda?fecha=2030-01-05');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.codigo).toBe('CLUB_NO_ENCONTRADO');

    const prohibido = await panel(ctx, recepcion, 'GET', '/mercadopago');
    expect(prohibido.statusCode).toBe(403);
    expect(prohibido.json().error.codigo).toBe('PERMISO_INSUFICIENTE');
    expect((await panel(ctx, admin, 'GET', '/mercadopago')).statusCode).toBe(200);
    expect(
      (await panel(ctx, admin, 'PUT', '/mercadopago', { accessToken: 'APP_USR-123456789' })).statusCode,
    ).toBe(403);
  });

  it('una request que modifica sin header CSRF se rechaza aunque tenga sesión', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/clubs/${ctx.club.id}/checkin`,
      headers: { cookie: recepcion },
      payload: { qr: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('agenda y turnos', () => {
  it('muestra reservas web, manuales y bloqueos con cliente y saldo; los holds vencidos no', async () => {
    const vencido = await reservar(ctx, pedido(ctx.canchas.f5b.id, iso('2030-01-12', '21:00')));
    expect(vencido.json().estado).toBe('PRE_RESERVADO');
    ctx.setAhora(new Date(AHORA.getTime() + 11 * 60_000)); // vence (sábado: timer de 10 min)
    await reservar(
      ctx,
      pedido(ctx.canchas.f5a.id, iso('2030-01-12', '20:00'), { nombre: 'Web', telefono: '11 5100-0001' }),
    );
    const manual = await panel(ctx, recepcion, 'POST', '/turnos', {
      canchaId: ctx.canchas.f5b.id,
      inicio: iso('2030-01-12', '18:00'),
      cliente: { nombre: 'Teléfono', telefono: '11 5100-0002' },
      nota: 'Paga en el club',
    });
    expect(manual.statusCode).toBe(201);
    expect(manual.json()).toMatchObject({
      origen: 'MANUAL',
      estado: 'CONFIRMADO',
      saldo: 4_500_000,
      nota: 'Paga en el club',
    });
    expect(manual.json().historial[0].actor).toMatch(/^usuario:/);
    const bloqueo = await panel(ctx, admin, 'POST', '/bloqueos', {
      canchaId: ctx.canchas.f7.id,
      inicio: iso('2030-01-12', '09:00'),
      fin: iso('2030-01-12', '13:00'),
      motivo: 'Mantenimiento',
    });
    expect(bloqueo.statusCode).toBe(201);

    const agenda = (await panel(ctx, recepcion, 'GET', '/agenda?fecha=2030-01-12')).json();
    expect(agenda.canchas).toHaveLength(3);
    expect(agenda.apertura).toEqual([
      { inicio: iso('2030-01-12', '09:00'), fin: iso('2030-01-13', '02:00') },
    ]);
    expect(
      agenda.turnos.map((t: { origen: string; cliente: { nombre: string } | null }) => [
        t.origen,
        t.cliente?.nombre ?? null,
      ]),
    ).toEqual([
      ['BLOQUEO', null],
      ['MANUAL', 'Teléfono'],
      ['WEB', 'Web'],
    ]);
    expect(agenda.turnos[2]).toMatchObject({
      estado: 'PRE_RESERVADO',
      montoSena: 2_250_000,
      pagado: 0,
      saldo: 4_500_000,
    });
  });

  it('carga manual sobre un horario ocupado → 409 con el turno que molesta', async () => {
    await reservar(
      ctx,
      pedido(ctx.canchas.f5a.id, iso('2030-01-13', '20:00'), {
        nombre: 'Ocupante',
        telefono: '11 5200-0001',
      }),
    );
    const res = await panel(ctx, recepcion, 'POST', '/turnos', {
      canchaId: ctx.canchas.f5a.id,
      inicio: iso('2030-01-13', '20:30'),
      cliente: { nombre: 'Xavi', telefono: '11 5200-0002' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.detalle.conflictos[0]).toMatchObject({ cliente: 'Ocupante', origen: 'WEB' });
  });

  it('cancelar saca el turno de la agenda (salvo incluirCancelados) y queda en el historial', async () => {
    const r = await reservar(ctx, pedido(ctx.canchas.f5a.id, iso('2030-01-14', '20:00')));
    const turnoId = (await panel(ctx, recepcion, 'GET', '/agenda?fecha=2030-01-14')).json().turnos[0].id;
    const c = await panel(ctx, recepcion, 'POST', `/turnos/${turnoId}/cancelar`, {
      motivo: 'lluvia',
      devolverSena: false,
    });
    expect(c.json()).toMatchObject({ estado: 'CANCELADO', senaADevolver: 0 });
    expect((await panel(ctx, recepcion, 'GET', '/agenda?fecha=2030-01-14')).json().turnos).toHaveLength(0);
    expect(
      (await panel(ctx, recepcion, 'GET', '/agenda?fecha=2030-01-14&incluirCancelados=true')).json().turnos,
    ).toHaveLength(1);
    const detalle = (await panel(ctx, recepcion, 'GET', `/turnos/${turnoId}`)).json();
    expect(detalle.historial.map((h: { a: string }) => h.a)).toEqual(['PRE_RESERVADO', 'CANCELADO']);
    expect(detalle.codigo).toBe(r.json().codigo);
  });

  it('seña en efectivo → confirma; check-in con el QR → PRESENTE y saldo a cobrar', async () => {
    ctx.setAhora(new Date(iso('2030-01-04', '19:10')));
    const r = await reservar(ctx, pedido(ctx.canchas.f5a.id, iso('2030-01-04', '20:00')));
    const turnoId = (await panel(ctx, recepcion, 'GET', '/agenda?fecha=2030-01-04'))
      .json()
      .turnos.find((t: { inicio: string }) => t.inicio === iso('2030-01-04', '20:00')).id;
    const pago = await panel(ctx, recepcion, 'POST', `/turnos/${turnoId}/pagos`, {
      monto: 2_250_000,
      medio: 'EFECTIVO',
      concepto: 'SENA',
    });
    expect(pago.json()).toMatchObject({ estado: 'CONFIRMADO', pagado: 2_250_000, saldo: 2_250_000 });

    const qr = `https://cancheria.test/r/${r.json().codigo}`;
    const checkin = await panel(ctx, recepcion, 'POST', '/checkin', { qr });
    expect(checkin.json()).toMatchObject({ yaRegistrado: false, estado: 'PRESENTE', saldo: 2_250_000 });
    expect((await panel(ctx, recepcion, 'POST', '/checkin', { qr })).json().yaRegistrado).toBe(true);
    expect((await panel(ctx, recepcion, 'POST', '/checkin', { qr: 'hola' })).json().error.codigo).toBe(
      'QR_INVALIDO',
    );
  });
});

describe('transferencias y reembolsos', () => {
  it('el cliente sube el comprobante, recepción lo ve, lo descarga y lo aprueba', async () => {
    const r = await reservar(ctx, pedido(ctx.canchas.f5b.id, iso('2030-01-15', '20:00')));
    await ctx.app.inject({
      method: 'POST',
      url: `/public/reservas/${r.json().codigo}/transferencia`,
      ...multipart('comprobante', 'c.png', 'image/png', PNG),
    });
    const lista = (await panel(ctx, recepcion, 'GET', '/transferencias')).json();
    const item = lista.find(
      (t: { turno: { inicio: string } }) => t.turno.inicio === iso('2030-01-15', '20:00'),
    );
    expect(item).toMatchObject({ estado: 'EN_REVISION', monto: 2_250_000, cancha: 'Cancha 2' });

    const archivo = await panel(ctx, recepcion, 'GET', `/pagos/${item.pagoId}/comprobante`);
    expect(archivo.headers['content-type']).toBe('image/png');
    expect(archivo.headers['x-content-type-options']).toBe('nosniff');
    expect(archivo.rawPayload.equals(PNG)).toBe(true);

    const ok = await panel(ctx, recepcion, 'POST', `/pagos/${item.pagoId}/aprobar`);
    expect(ok.json().tipo).toBe('CONFIRMADO');
    expect((await ctx.app.inject(`/public/reservas/${r.json().codigo}`)).json()).toMatchObject({
      estado: 'CONFIRMADO',
      senaEnRevision: false,
    });
  });

  it('un admin de otro club no puede ver ni aprobar ese comprobante', async () => {
    const r = await reservar(ctx, pedido(ctx.canchas.f5b.id, iso('2030-01-15', '21:00')));
    await ctx.app.inject({
      method: 'POST',
      url: `/public/reservas/${r.json().codigo}/transferencia`,
      ...multipart('comprobante', 'c.png', 'image/png', PNG),
    });
    const { pagoId } = (await panel(ctx, recepcion, 'GET', '/transferencias'))
      .json()
      .find((t: { turno: { inicio: string } }) => t.turno.inicio === iso('2030-01-15', '21:00'));
    const otro = await crearClubDemo(ctx.db, `otro-${randomUUID().slice(0, 8)}`);
    const ajeno = await usuarioPanel(ctx, 'OWNER', otro.club.id);
    const url = (ruta: string) => `/admin/clubs/${otro.club.id}${ruta}`;
    const headers = { cookie: ajeno.cookie, 'x-cancheria-csrf': '1' };
    expect((await ctx.app.inject({ url: url(`/pagos/${pagoId}/comprobante`), headers })).statusCode).toBe(
      404,
    );
    expect(
      (await ctx.app.inject({ method: 'POST', url: url(`/pagos/${pagoId}/aprobar`), headers })).statusCode,
    ).toBe(404);
  });

  it('reembolsos: los de MP son automáticos; los de efectivo se marcan a mano (ADMIN)', async () => {
    const r = await reservar(ctx, pedido(ctx.canchas.f5a.id, iso('2030-01-16', '20:00')));
    const agenda = (await panel(ctx, recepcion, 'GET', '/agenda?fecha=2030-01-16')).json();
    const turnoId = agenda.turnos[0].id;
    await panel(ctx, recepcion, 'POST', `/turnos/${turnoId}/pagos`, {
      monto: 2_250_000,
      medio: 'EFECTIVO',
      concepto: 'SENA',
    });
    await panel(ctx, recepcion, 'POST', `/turnos/${turnoId}/cancelar`, {
      motivo: 'cancha inundada',
      devolverSena: true,
    });

    const [reembolso] = (await panel(ctx, recepcion, 'GET', '/reembolsos?estado=PENDIENTE'))
      .json()
      .filter((x: { turnoId: string }) => x.turnoId === turnoId);
    expect(reembolso).toMatchObject({ medio: 'EFECTIVO', manual: true, motivo: 'TURNO_CANCELADO' });
    expect((await panel(ctx, recepcion, 'POST', `/reembolsos/${reembolso.id}/hecho`)).statusCode).toBe(403);
    expect((await panel(ctx, admin, 'POST', `/reembolsos/${reembolso.id}/hecho`)).statusCode).toBe(200);
    expect(r.statusCode).toBe(201);

    // Uno de MP pendiente no se puede marcar a mano.
    const r2 = await reservar(ctx, pedido(ctx.canchas.f5a.id, iso('2030-01-16', '21:00')));
    await ctx.app.inject({ method: 'POST', url: `/public/reservas/${r2.json().codigo}/mercadopago` });
    const turno2 = [...ctx.pasarela.preferencias.values()].at(-1)!.referenciaExterna;
    const pagoMp = ctx.pasarela.pagar(turno2, 2_250_000);
    await ctx.app.inject({
      method: 'POST',
      url: `/webhooks/mercadopago/${ctx.slug}?data.id=${pagoMp.id}&type=payment`,
      headers: {
        'x-request-id': 'r',
        'x-signature': (await import('@cancheria/servicios/testing')).firmarWebhook(
          'secreto-webhook',
          pagoMp.id,
          'r',
        ),
      },
    });
    await panel(ctx, recepcion, 'POST', `/turnos/${turno2}/cancelar`, {
      motivo: 'sin luz',
      devolverSena: true,
    });
    const [mp] = (await panel(ctx, admin, 'GET', '/reembolsos'))
      .json()
      .filter((x: { turnoId: string }) => x.turnoId === turno2);
    expect(mp).toMatchObject({ medio: 'MERCADO_PAGO', manual: false, estado: 'PENDIENTE' });
    expect((await panel(ctx, admin, 'POST', `/reembolsos/${mp.id}/hecho`)).json().error.codigo).toBe(
      'REEMBOLSO_AUTOMATICO',
    );
  });
});

describe('medios de cobro', () => {
  it('Mercado Pago: valida el token, nunca lo devuelve y se refleja en la página pública', async () => {
    const invalido = await panel(ctx, owner, 'PUT', '/mercadopago', { accessToken: 'cualquier-cosa-123' });
    expect(invalido.json().error.codigo).toBe('CREDENCIALES_MP_INVALIDAS');

    const ok = await panel(ctx, owner, 'PUT', '/mercadopago', {
      accessToken: 'APP_USR-nuevo-token',
      webhookSecret: 'secreto-nuevo-123',
    });
    expect(ok.json()).toEqual({ configurado: true, cuenta: { id: '123456', nickname: 'CLUB_TEST' } });
    const ver = await panel(ctx, admin, 'GET', '/mercadopago');
    expect(ver.json()).toEqual({
      configurado: true,
      conWebhookSecret: true,
      urlWebhook: `https://api.cancheria.test/webhooks/mercadopago/${ctx.slug}`,
    });
    expect(ver.body).not.toContain('APP_USR');

    expect((await panel(ctx, owner, 'DELETE', '/mercadopago')).statusCode).toBe(204);
    expect((await ctx.app.inject(`/public/clubs/${ctx.slug}`)).json().mediosPago.mercadoPago).toBe(false);
    await panel(ctx, owner, 'PUT', '/mercadopago', {
      accessToken: 'TEST-token-xxxx',
      webhookSecret: 'secreto-webhook',
    });
  });

  it('datos de transferencia: valida CBU/alias y se ven en la página pública', async () => {
    expect((await panel(ctx, admin, 'PUT', '/transferencia', { titular: 'Club' })).statusCode).toBe(400);
    expect(
      (await panel(ctx, admin, 'PUT', '/transferencia', { cbu: '123', titular: 'Club' })).statusCode,
    ).toBe(400);
    const ok = await panel(ctx, admin, 'PUT', '/transferencia', {
      alias: 'club.nuevo',
      titular: 'Club Nuevo SRL',
    });
    expect(ok.statusCode).toBe(200);
    expect((await ctx.app.inject(`/public/clubs/${ctx.slug}`)).json().mediosPago.transferencia).toEqual({
      alias: 'club.nuevo',
      titular: 'Club Nuevo SRL',
    });
  });
});
