import { CaptchaFalso } from '@cancheria/servicios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Contexto, crearContexto } from './helpers.ts';

let ctx: Contexto;
beforeAll(async () => {
  ctx = await crearContexto({ captcha: new CaptchaFalso() });
});
afterAll(() => ctx.cerrar());

const registro = (captcha?: string) =>
  ctx.app.inject({
    method: 'POST',
    url: '/admin/registro',
    headers: { 'x-cancheria-csrf': '1', ...(captcha ? { 'x-captcha': captcha } : {}) },
    payload: {
      club: { nombre: 'Con Captcha', slug: 'con-captcha', telefono: '11 5555-0042' },
      dueno: { nombre: 'Ana', email: 'captcha@club.test', contrasena: 'una-clave-larga' },
      aceptaTerminos: true,
    },
  });

describe('captcha en los formularios públicos', () => {
  it('registro de club: sin token o con uno inválido no; con uno válido sí', async () => {
    const sin = await registro();
    expect(sin.statusCode).toBe(400);
    expect(sin.json().error.codigo).toBe('CAPTCHA_INVALIDO');
    expect((await registro('falso')).statusCode).toBe(400);
    expect((await registro('ok')).statusCode).toBe(201);
  });

  it('lista de espera y olvidé mi contraseña también lo piden; las reservas no', async () => {
    const espera = await ctx.app.inject({
      method: 'POST',
      url: `/public/clubs/${ctx.slug}/lista-espera`,
      payload: {
        cliente: { nombre: 'Robot', telefono: '11 5000-1234' },
        fecha: '2030-01-05',
        desde: '19:00',
        hasta: '23:00',
      },
    });
    expect(espera.json().error.codigo).toBe('CAPTCHA_INVALIDO');
    const olvide = await ctx.app.inject({
      method: 'POST',
      url: '/admin/auth/olvide',
      headers: { 'x-cancheria-csrf': '1' },
      payload: { email: 'x@y.test' },
    });
    expect(olvide.json().error.codigo).toBe('CAPTCHA_INVALIDO');
    const reserva = await ctx.app.inject({
      method: 'POST',
      url: `/public/clubs/${ctx.slug}/reservas`,
      payload: { canchaId: ctx.canchas.f5a.id, inicio: 'mal' },
    });
    expect(reserva.json().error.codigo).not.toBe('CAPTCHA_INVALIDO');
  });
});
