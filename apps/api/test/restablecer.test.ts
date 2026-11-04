import { usuarios } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AHORA, type Contexto, crearContexto, usuarioPanel } from './helpers.ts';

let ctx: Contexto;
beforeAll(async () => {
  ctx = await crearContexto();
});
afterAll(() => ctx.cerrar());

const csrf = { 'x-cancheria-csrf': '1' };
const post = (url: string, payload: unknown, cookie?: string) =>
  ctx.app.inject({
    method: 'POST',
    url: `/admin${url}`,
    headers: { ...csrf, ...(cookie ? { cookie } : {}) },
    payload: payload as Record<string, unknown>,
  });
const login = (email: string, contrasena: string) => post('/auth/login', { email, contrasena });
const tokenDe = (texto: string) =>
  new URL(texto.match(/https:\/\/\S+/)?.[0] as string).searchParams.get('token');

describe('olvidé mi contraseña', () => {
  it('manda el link por mail; con él se elige una nueva y se cierran las sesiones abiertas', async () => {
    const { email, cookie } = await usuarioPanel(ctx, 'OWNER');
    const enviados = ctx.correo.enviados.length;

    expect((await post('/auth/olvide', { email })).statusCode).toBe(204);
    await vi.waitFor(() => expect(ctx.correo.enviados).toHaveLength(enviados + 1));
    const mail = ctx.correo.enviados.at(-1);
    expect(mail).toMatchObject({ para: email, asunto: 'Elegí una contraseña nueva para Canchería' });
    expect(mail?.texto).toContain('https://cancheria.test/panel/restablecer?token=');
    const token = tokenDe(mail?.texto ?? '') as string;

    expect((await post('/auth/restablecer', { token, nueva: 'otra-clave-larga' })).statusCode).toBe(204);
    // La sesión que tenía abierta se cerró.
    const yo = await ctx.app.inject({ method: 'GET', url: '/admin/auth/yo', headers: { cookie } });
    expect(yo.statusCode).toBe(401);
    expect((await login(email, 'contrasena-de-prueba')).statusCode).toBe(401);
    expect((await login(email, 'otra-clave-larga')).statusCode).toBe(200);

    // El link sirve una sola vez.
    const otraVez = await post('/auth/restablecer', { token, nueva: 'tercera-clave-larga' });
    expect(otraVez.statusCode).toBe(410);
    expect(otraVez.json().error.codigo).toBe('LINK_VENCIDO');
  });

  it('con un email sin cuenta responde igual y no manda nada', async () => {
    const enviados = ctx.correo.enviados.length;
    expect((await post('/auth/olvide', { email: 'nadie@club.test' })).statusCode).toBe(204);
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.correo.enviados).toHaveLength(enviados);
  });

  it('el link vence en 1 hora y pedir otro anula el anterior', async () => {
    const { email } = await usuarioPanel(ctx, 'RECEPCION');
    await post('/auth/olvide', { email });
    await vi.waitFor(() => expect(ctx.correo.enviados.at(-1)?.para).toBe(email));
    const primero = tokenDe(ctx.correo.enviados.at(-1)?.texto ?? '') as string;
    await post('/auth/olvide', { email });
    await vi.waitFor(() => expect(tokenDe(ctx.correo.enviados.at(-1)?.texto ?? '')).not.toBe(primero));
    const segundo = tokenDe(ctx.correo.enviados.at(-1)?.texto ?? '') as string;
    expect((await post('/auth/restablecer', { token: primero, nueva: 'una-clave-larga' })).statusCode).toBe(
      410,
    );

    ctx.setAhora(new Date(AHORA.getTime() + 61 * 60_000));
    try {
      expect((await post('/auth/restablecer', { token: segundo, nueva: 'una-clave-larga' })).statusCode).toBe(
        410,
      );
    } finally {
      ctx.setAhora(AHORA);
    }
  });

  it('exige una contraseña de al menos 10 caracteres', async () => {
    const { email } = await usuarioPanel(ctx, 'ADMIN');
    await post('/auth/olvide', { email });
    await vi.waitFor(() => expect(ctx.correo.enviados.at(-1)?.para).toBe(email));
    const token = tokenDe(ctx.correo.enviados.at(-1)?.texto ?? '') as string;
    const res = await post('/auth/restablecer', { token, nueva: 'corta' });
    expect(res.json().error.codigo).toBe('CONTRASENA_CORTA');
  });

  it('el superadmin genera el link para mandarlo por WhatsApp; nadie más puede', async () => {
    const sa = await usuarioPanel(ctx, 'OWNER');
    await ctx.db.update(usuarios).set({ esSuperadmin: true }).where(eq(usuarios.id, sa.usuario.id));
    const { email, cookie: otro } = await usuarioPanel(ctx, 'OWNER');

    expect((await post('/plataforma/restablecer', { email }, otro)).statusCode).toBe(404);
    const res = await post('/plataforma/restablecer', { email }, sa.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email, venceEnMinutos: 60 });
    const token = new URL(res.json().link).searchParams.get('token') as string;
    expect((await post('/auth/restablecer', { token, nueva: 'clave-nueva-larga' })).statusCode).toBe(204);
    expect((await login(email, 'clave-nueva-larga')).statusCode).toBe(200);

    const nadie = await post('/plataforma/restablecer', { email: 'nadie@club.test' }, sa.cookie);
    expect(nadie.json().error.codigo).toBe('USUARIO_NO_ENCONTRADO');
  });
});
