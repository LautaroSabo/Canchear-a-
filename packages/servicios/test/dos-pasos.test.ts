import { usuarios } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { codigoTotp, pasoDe } from '../src/totp.ts';
import { type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
let usuarioId: string;
const EMAIL = 'dueno2fa@club.test';
const CLAVE = 'una-clave-larga';
beforeEach(async () => {
  ctx = await crearContexto();
  usuarioId = (await ctx.auth.crearUsuario({ email: EMAIL, nombre: 'Dueño', contrasena: CLAVE })).id;
  return () => ctx.cerrar();
});
const codigoAhora = (secreto: string) => codigoTotp(secreto, pasoDe(ctx.ahora()));

/** Activa la verificación en dos pasos y devuelve el secreto y los códigos de recuperación. */
async function activar() {
  const sesion = await ctx.auth.login(EMAIL, CLAVE);
  if (sesion.dosPasos) throw new Error('no debería');
  const usuario = await ctx.auth.sesion(sesion.token);
  const { secreto, uri } = await ctx.auth.prepararDosPasos(usuarioId);
  expect(uri).toContain(`secret=${secreto}`);
  const { codigosRecuperacion } = await ctx.auth.activarDosPasos(
    usuarioId,
    usuario!.sesionId,
    codigoAhora(secreto),
  );
  return { secreto, codigosRecuperacion, token: sesion.token };
}

describe('verificación en dos pasos', () => {
  it('sin activar, el login sigue igual', async () => {
    expect((await ctx.auth.login(EMAIL, CLAVE)).dosPasos).toBe(false);
    expect(await ctx.auth.estadoDosPasos(usuarioId)).toMatchObject({ activa: false });
  });

  it('activada: la contraseña sola no alcanza; con el código entra, y el mismo código no se reusa', async () => {
    const { secreto, codigosRecuperacion } = await activar();
    expect(codigosRecuperacion).toHaveLength(8);
    expect(codigosRecuperacion[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await ctx.auth.estadoDosPasos(usuarioId)).toMatchObject({ activa: true, codigosRecuperacion: 8 });

    ctx.avanzar(1);
    const r = await ctx.auth.login(EMAIL, CLAVE);
    expect(r).toMatchObject({ dosPasos: true, token: undefined });
    if (!r.dosPasos) throw new Error('falta el desafío');
    await expect(ctx.auth.loginDosPasos(r.desafio, '000000')).rejects.toMatchObject({
      codigo: 'CODIGO_INVALIDO',
    });
    const ok = await ctx.auth.loginDosPasos(r.desafio, codigoAhora(secreto));
    expect(ok.token).toBeTruthy();
    expect(await ctx.auth.sesion(ok.token)).toMatchObject({ email: EMAIL });
    // El desafío se usó: no sirve de nuevo.
    await expect(ctx.auth.loginDosPasos(r.desafio, codigoAhora(secreto))).rejects.toMatchObject({
      codigo: 'DESAFIO_VENCIDO',
    });
    // Mismo código en otro login (mismos 30 segundos): no vale.
    const r2 = await ctx.auth.login(EMAIL, CLAVE);
    if (!r2.dosPasos) throw new Error('falta el desafío');
    await expect(ctx.auth.loginDosPasos(r2.desafio, codigoAhora(secreto))).rejects.toMatchObject({
      codigo: 'CODIGO_INVALIDO',
    });
  });

  it('un código de recuperación sirve una sola vez', async () => {
    const { codigosRecuperacion } = await activar();
    const r = await ctx.auth.login(EMAIL, CLAVE);
    if (!r.dosPasos) throw new Error('falta el desafío');
    const ok = await ctx.auth.loginDosPasos(r.desafio, codigosRecuperacion[0]!.toLowerCase());
    expect(ok.codigosRestantes).toBe(7);
    const r2 = await ctx.auth.login(EMAIL, CLAVE);
    if (!r2.dosPasos) throw new Error('falta el desafío');
    await expect(ctx.auth.loginDosPasos(r2.desafio, codigosRecuperacion[0]!)).rejects.toMatchObject({
      codigo: 'CODIGO_INVALIDO',
    });
  });

  it('5 intentos fallidos o 5 minutos y hay que volver a poner la contraseña', async () => {
    const { secreto } = await activar();
    const r = await ctx.auth.login(EMAIL, CLAVE);
    if (!r.dosPasos) throw new Error('falta el desafío');
    for (let i = 0; i < 5; i++) await ctx.auth.loginDosPasos(r.desafio, '111111').catch(() => {});
    ctx.avanzar(1);
    await expect(ctx.auth.loginDosPasos(r.desafio, codigoAhora(secreto))).rejects.toMatchObject({
      codigo: 'DESAFIO_VENCIDO',
    });
    const r2 = await ctx.auth.login(EMAIL, CLAVE);
    if (!r2.dosPasos) throw new Error('falta el desafío');
    ctx.avanzar(6);
    await expect(ctx.auth.loginDosPasos(r2.desafio, codigoAhora(secreto))).rejects.toMatchObject({
      codigo: 'DESAFIO_VENCIDO',
    });
  });

  it('activarla cierra las otras sesiones; desactivarla pide contraseña y código', async () => {
    const otra = await ctx.auth.login(EMAIL, CLAVE);
    const { secreto } = await activar();
    expect(await ctx.auth.sesion(otra.token)).toBeNull();
    ctx.avanzar(1);
    await expect(ctx.auth.desactivarDosPasos(usuarioId, 'mala', codigoAhora(secreto))).rejects.toMatchObject({
      codigo: 'CONTRASENA_ACTUAL_INCORRECTA',
    });
    await expect(ctx.auth.desactivarDosPasos(usuarioId, CLAVE, '123456')).rejects.toMatchObject({
      codigo: 'CODIGO_INVALIDO',
    });
    await ctx.auth.desactivarDosPasos(usuarioId, CLAVE, codigoAhora(secreto));
    expect((await ctx.auth.login(EMAIL, CLAVE)).dosPasos).toBe(false);
    const [u] = await ctx.db.select().from(usuarios).where(eq(usuarios.id, usuarioId));
    expect(u).toMatchObject({ totpSecreto: null, codigosRecuperacion: [] });
  });

  it('un código mal copiado no la activa', async () => {
    await ctx.auth.prepararDosPasos(usuarioId);
    await expect(ctx.auth.activarDosPasos(usuarioId, 'x', '123456')).rejects.toMatchObject({
      codigo: 'CODIGO_INVALIDO',
    });
    expect(await ctx.auth.estadoDosPasos(usuarioId)).toMatchObject({ activa: false });
  });
});
