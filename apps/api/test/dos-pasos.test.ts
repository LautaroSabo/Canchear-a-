import { codigoTotp, pasoDe } from '@cancheria/servicios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AHORA, type Contexto, crearContexto, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
beforeAll(async () => {
  ctx = await crearContexto();
});
afterAll(() => ctx.cerrar());

const csrf = { 'x-cancheria-csrf': '1' };
const post = (url: string, payload: Record<string, unknown>, cookie?: string) =>
  ctx.app.inject({ method: 'POST', url, headers: { ...csrf, ...(cookie ? { cookie } : {}) }, payload });

describe('verificación en dos pasos por la API', () => {
  it('activada: el login con contraseña no da cookie hasta poner el código', async () => {
    const { email, cookie } = await usuarioPanel(ctx, 'OWNER');
    const { secreto } = (await post('/admin/auth/dos-pasos/preparar', {}, cookie)).json();
    const activar = await post(
      '/admin/auth/dos-pasos/activar',
      { codigo: codigoTotp(secreto, pasoDe(AHORA)) },
      cookie,
    );
    expect(activar.statusCode).toBe(200);
    expect(activar.json().codigosRecuperacion).toHaveLength(8);

    const login = await post('/admin/auth/login', { email, contrasena: 'contrasena-de-prueba' });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ dosPasos: true });
    expect(login.cookies.find((c) => c.name === 'cancheria_sesion')).toBeUndefined();

    const mal = await post('/admin/auth/login/dos-pasos', {
      desafio: login.json().desafio,
      codigo: '000000',
    });
    expect(mal.statusCode).toBe(401);
    const ok = await post('/admin/auth/login/dos-pasos', {
      desafio: login.json().desafio,
      codigo: activar.json().codigosRecuperacion[0],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ usuario: { email }, codigosRecuperacionRestantes: 7 });
    expect(ok.cookies.find((c) => c.name === 'cancheria_sesion')).toBeDefined();
  });
});
