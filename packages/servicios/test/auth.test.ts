import { sesiones, usuarios } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { alcanzaRol, hashContrasena, verificarContrasena } from '../src/auth.ts';
import { type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
beforeEach(async () => {
  ctx = await crearContexto();
  return () => ctx.cerrar();
});

describe('contraseñas', () => {
  it('hash con sal aleatoria y verificación', async () => {
    const a = await hashContrasena('una contraseña larga');
    const b = await hashContrasena('una contraseña larga');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verificarContrasena('una contraseña larga', a)).toBe(true);
    expect(await verificarContrasena('otra', a)).toBe(false);
    expect(await verificarContrasena('x', 'basura')).toBe(false);
  });

  it('jerarquía de roles', () => {
    expect(alcanzaRol('OWNER', 'ADMIN')).toBe(true);
    expect(alcanzaRol('ADMIN', 'ADMIN')).toBe(true);
    expect(alcanzaRol('RECEPCION', 'ADMIN')).toBe(false);
  });
});

describe('sesiones', () => {
  const crear = () =>
    ctx.auth.crearUsuario({ email: 'Recepcion@Club.Test', nombre: 'Rec', contrasena: 'muy-secreta-123' });

  it('login (email sin distinguir mayúsculas), sesión válida y logout', async () => {
    const u = await crear();
    const { token } = await ctx.auth.login('recepcion@club.test', 'muy-secreta-123', { ip: '10.0.0.1' });
    expect((await ctx.auth.sesion(token))?.id).toBe(u.id);
    // En la base solo está el hash del token.
    const [s] = await ctx.db.select().from(sesiones);
    expect(s?.tokenHash.toString('base64url')).not.toBe(token);
    await ctx.auth.logout(token);
    expect(await ctx.auth.sesion(token)).toBeNull();
  });

  it('mismo error con contraseña incorrecta o email inexistente', async () => {
    await crear();
    await expect(ctx.auth.login('recepcion@club.test', 'mal')).rejects.toMatchObject({
      codigo: 'CREDENCIALES_INVALIDAS',
    });
    await expect(ctx.auth.login('nadie@club.test', 'mal')).rejects.toMatchObject({
      codigo: 'CREDENCIALES_INVALIDAS',
    });
  });

  it('vence a los 7 días sin uso y se renueva si se usa', async () => {
    await crear();
    const { token } = await ctx.auth.login('recepcion@club.test', 'muy-secreta-123');
    ctx.avanzar(6 * 24 * 60);
    const renovada = await ctx.auth.sesion(token);
    expect(renovada?.expiraEn.getTime()).toBe(ctx.ahora().getTime() + 7 * 24 * 60 * 60_000);
    ctx.avanzar(6 * 24 * 60);
    expect(await ctx.auth.sesion(token)).not.toBeNull();
    ctx.avanzar(8 * 24 * 60);
    expect(await ctx.auth.sesion(token)).toBeNull();
    expect(await ctx.auth.purgarVencidas()).toBe(1);
  });

  it('un usuario desactivado pierde el acceso aunque tenga sesión', async () => {
    const u = await crear();
    const { token } = await ctx.auth.login('recepcion@club.test', 'muy-secreta-123');
    await ctx.db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, u.id));
    expect(await ctx.auth.sesion(token)).toBeNull();
    await expect(ctx.auth.login('recepcion@club.test', 'muy-secreta-123')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('roles por club y validaciones de alta', async () => {
    const u = await crear();
    await ctx.auth.asignarRol(ctx.club.id, u.id, 'RECEPCION');
    expect(await ctx.auth.rolEnClub(u.id, ctx.club.id)).toBe('RECEPCION');
    await ctx.auth.asignarRol(ctx.club.id, u.id, 'ADMIN');
    expect(await ctx.auth.clubsDe(u.id)).toMatchObject([{ id: ctx.club.id, rol: 'ADMIN' }]);
    await expect(crear()).rejects.toMatchObject({ codigo: 'EMAIL_EN_USO' });
    await expect(
      ctx.auth.crearUsuario({ email: 'a@b.c', nombre: 'x', contrasena: 'corta' }),
    ).rejects.toMatchObject({
      codigo: 'CONTRASENA_CORTA',
    });
  });
});
