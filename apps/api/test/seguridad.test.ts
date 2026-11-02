import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Contexto, crearContexto, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
beforeAll(async () => {
  ctx = await crearContexto({ loginsPorMinuto: 3 });
});
afterAll(() => ctx.cerrar());

const login = (email: string, contrasena: string, xff?: string) =>
  ctx.app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    headers: { 'x-cancheria-csrf': '1', ...(xff ? { 'x-forwarded-for': xff } : {}) },
    payload: { email, contrasena },
  });

describe('seguridad', () => {
  it('falsear X-Forwarded-For no saltea el límite por IP (se usa la IP que agrega el proxy)', async () => {
    // El proxy del hosting agrega la IP real al final; lo de adelante lo escribe el cliente.
    const codigos = [];
    for (let i = 0; i < 4; i++) {
      codigos.push((await login('nadie@club.test', 'probando', `10.0.0.${i}, 200.1.1.1`)).statusCode);
    }
    expect(codigos).toEqual([401, 401, 401, 429]);
  });

  it('una cuenta se bloquea 15 minutos tras 10 fallas, aunque vengan de IPs distintas', async () => {
    const { email } = await usuarioPanel(ctx, 'OWNER');
    const codigos = [];
    for (let i = 0; i < 11; i++) {
      codigos.push((await login(email, 'incorrecta', `200.2.2.${i}`)).statusCode);
    }
    expect(codigos.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codigos[10]).toBe(429);
    // Ni con la contraseña correcta, hasta que pase la ventana.
    expect((await login(email, 'contrasena-de-prueba', '200.2.2.99')).statusCode).toBe(429);
  });

  it('las respuestas traen encabezados de seguridad', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/public/clubs/${ctx.slug}` });
    expect(res.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
    });
  });

  it('un club pendiente o el panel no se pueden usar sin sesión', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/admin/clubs/${ctx.club.id}/agenda?fecha=2030-01-05`,
    });
    expect(res.statusCode).toBe(401);
    const plataforma = await ctx.app.inject({ method: 'GET', url: '/admin/plataforma/clubs' });
    expect(plataforma.statusCode).toBe(401);
  });
});
