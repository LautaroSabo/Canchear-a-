import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Contexto, crearContexto, iso, panel, usuarioPanel } from './helpers.ts';

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
afterAll(() => ctx.cerrar());

interface Slot {
  inicio: string;
  precio: number;
}
const grilla = async (fecha: string) => {
  const res = await ctx.app.inject(`/public/clubs/${ctx.slug}/disponibilidad?fecha=${fecha}&jugadores=5`);
  return (res.json() as { canchas: { nombre: string; slots: Slot[] }[] }).canchas;
};

describe('configuración del club', () => {
  it('GET /config: todo lo editable y sin avisos en el club demo; recepción no entra', async () => {
    const res = await panel(ctx, admin, 'GET', '/config');
    expect(res.statusCode).toBe(200);
    const cfg = res.json();
    expect(cfg.canchas.map((c: { nombre: string }) => c.nombre)).toEqual([
      'Cancha 1',
      'Cancha 2',
      'Cancha 3',
    ]);
    expect(cfg.horarios).toContainEqual({ diaSemana: 6, abre: '09:00', cierra: '02:00' });
    expect(cfg.tarifas.length).toBeGreaterThan(0);
    expect(cfg.reglas.length).toBeGreaterThan(0);
    expect(cfg.avisos).toEqual([]);
    expect((await panel(ctx, recepcion, 'GET', '/config')).statusCode).toBe(403);
  });

  it('una tarifa nueva se ve en la grilla pública al instante', async () => {
    const res = await panel(ctx, admin, 'POST', '/config/tarifas', {
      canchaId: ctx.canchas.f5a!.id,
      diaSemana: 6,
      horaDesde: '20:00',
      horaHasta: '22:00',
      precio: 5_200_000,
      etiqueta: 'Sábado noche',
      vigenteDesde: '2026-01-01',
      vigenteHasta: null,
    });
    expect(res.statusCode).toBe(201);
    const [c1, c2] = await grilla('2030-01-05');
    expect(c1?.slots.find((s) => s.inicio === iso('2030-01-05', '20:00'))?.precio).toBe(5_200_000);
    expect(c2?.slots.find((s) => s.inicio === iso('2030-01-05', '20:00'))?.precio).toBe(4_500_000);

    const id = res.json().id;
    expect((await panel(ctx, admin, 'DELETE', `/config/tarifas/${id}`)).statusCode).toBe(204);
    const [c1b] = await grilla('2030-01-05');
    expect(c1b?.slots.find((s) => s.inicio === iso('2030-01-05', '20:00'))?.precio).toBe(4_500_000);
  });

  it('errores de validación con código y mensaje en castellano', async () => {
    const superpuesta = await panel(ctx, admin, 'POST', '/config/tarifas', {
      canchaId: null,
      diaSemana: null,
      horaDesde: '19:00',
      horaHasta: '21:00',
      precio: 1,
      etiqueta: null,
      vigenteDesde: '2026-01-01',
      vigenteHasta: null,
    });
    expect(superpuesta.statusCode).toBe(409);
    expect(superpuesta.json().error.codigo).toBe('TARIFA_SUPERPUESTA');

    const hora = await panel(ctx, admin, 'PUT', '/config/horarios', [
      { diaSemana: 1, abre: '25:00', cierra: '10:00' },
    ]);
    expect(hora.statusCode).toBe(400);

    const pisadas = await panel(ctx, admin, 'PUT', '/config/horarios', [
      { diaSemana: 1, abre: '10:00', cierra: '14:00' },
      { diaSemana: 1, abre: '12:00', cierra: '16:00' },
    ]);
    expect(pisadas.statusCode).toBe(422);
    expect(pisadas.json().error.codigo).toBe('HORARIOS_SUPERPUESTOS');
  });

  it('feriado cerrado: el público no ve turnos ese día', async () => {
    expect(
      (
        await panel(ctx, admin, 'PUT', '/config/dias-especiales/2030-01-07', {
          cerrado: true,
          abre: null,
          cierra: null,
          motivo: 'Feriado',
        })
      ).statusCode,
    ).toBe(204);
    expect((await grilla('2030-01-07')).every((c) => c.slots.length === 0)).toBe(true);
    expect((await panel(ctx, admin, 'DELETE', '/config/dias-especiales/2030-01-07')).statusCode).toBe(204);
    expect((await grilla('2030-01-07'))[0]?.slots.length).toBeGreaterThan(0);
  });

  it('cancha: alta y desactivación', async () => {
    const res = await panel(ctx, admin, 'POST', '/config/canchas', {
      nombre: 'Cancha 4',
      jugadoresPorLado: 5,
      superficie: 'SINTETICO',
      techada: true,
      iluminacion: true,
      duracionTurnoMin: 60,
      orden: 4,
      activa: true,
    });
    expect(res.statusCode).toBe(201);
    expect((await grilla('2030-01-05')).map((c) => c.nombre)).toContain('Cancha 4');
    const id = res.json().id;
    expect((await panel(ctx, admin, 'PATCH', `/config/canchas/${id}`, { activa: false })).statusCode).toBe(
      204,
    );
    expect((await grilla('2030-01-05')).map((c) => c.nombre)).not.toContain('Cancha 4');
  });

  it('datos del club', async () => {
    const res = await panel(ctx, admin, 'PATCH', '/config/club', {
      telefono: '+5491122223333',
      direccion: '',
    });
    expect(res.statusCode).toBe(204);
    const pub = (await ctx.app.inject(`/public/clubs/${ctx.slug}`)).json();
    expect(pub).toMatchObject({ telefono: '+5491122223333', direccion: null });
  });
});

describe('usuarios del club (solo dueños)', () => {
  it('admin no puede ver ni invitar', async () => {
    expect((await panel(ctx, admin, 'GET', '/config/usuarios')).statusCode).toBe(403);
    expect(
      (
        await panel(ctx, admin, 'POST', '/config/usuarios', {
          email: 'x@club.test',
          nombre: 'X',
          rol: 'OWNER',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('invitar devuelve la contraseña generada, que sirve para entrar', async () => {
    const res = await panel(ctx, owner, 'POST', '/config/usuarios', {
      email: 'caja@club.test',
      nombre: 'Caja',
      rol: 'RECEPCION',
    });
    expect(res.statusCode).toBe(201);
    const { usuarioId, contrasenaGenerada } = res.json();
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      headers: { 'x-cancheria-csrf': '1' },
      payload: { email: 'caja@club.test', contrasena: contrasenaGenerada },
    });
    expect(login.statusCode).toBe(200);
    expect(
      (await panel(ctx, owner, 'PATCH', `/config/usuarios/${usuarioId}`, { rol: 'ADMIN' })).statusCode,
    ).toBe(204);
    const lista = (await panel(ctx, owner, 'GET', '/config/usuarios')).json();
    expect(lista).toContainEqual(expect.objectContaining({ email: 'caja@club.test', rol: 'ADMIN' }));
    expect((await panel(ctx, owner, 'DELETE', `/config/usuarios/${usuarioId}`)).statusCode).toBe(204);
  });
});

describe('POST /admin/auth/contrasena', () => {
  it('cambia la contraseña con la actual correcta', async () => {
    const { email, cookie } = await usuarioPanel(ctx, 'RECEPCION');
    const cambiar = (actual: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/admin/auth/contrasena',
        headers: { cookie, 'x-cancheria-csrf': '1' },
        payload: { actual, nueva: 'otra-contrasena-larga' },
      });
    expect((await cambiar('incorrecta')).statusCode).toBe(422);
    expect((await cambiar('contrasena-de-prueba')).statusCode).toBe(204);
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      headers: { 'x-cancheria-csrf': '1' },
      payload: { email, contrasena: 'otra-contrasena-larga' },
    });
    expect(login.statusCode).toBe(200);
  });
});

describe('CORS del panel', () => {
  it.each(['PUT', 'PATCH', 'DELETE'])('el preflight permite %s con cookie y header CSRF', async (metodo) => {
    const res = await ctx.app.inject({
      method: 'OPTIONS',
      url: `/admin/clubs/${ctx.club.id}/config/club`,
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': metodo,
        'access-control-request-headers': 'content-type,x-cancheria-csrf',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain(metodo);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
