import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import {
  iniciarAvisoErrores,
  limitadorDeRepetidos,
  limpiarEvento,
  SIN_AVISO,
  taparDatos,
} from '../src/aviso-errores.ts';

describe('aviso de errores', () => {
  it('sin DSN no hace nada', () => {
    expect(iniciarAvisoErrores({ servicio: 'api' })).toBe(SIN_AVISO);
  });

  it('el mismo error se avisa una vez cada 10 minutos', () => {
    let ahora = 0;
    const repetido = limitadorDeRepetidos(10 * 60_000, () => ahora);
    expect(repetido(new Error('sin conexión'), { tarea: 'despacho' })).toBe(false);
    expect(repetido(new Error('sin conexión'), { tarea: 'despacho' })).toBe(true);
    expect(repetido(new Error('sin conexión'), { tarea: 'expiracion' })).toBe(false);
    expect(repetido(new Error('otro error'), { tarea: 'despacho' })).toBe(false);
    ahora = 10 * 60_000;
    expect(repetido(new Error('sin conexión'), { tarea: 'despacho' })).toBe(false);
  });

  it('tapa emails, teléfonos y DNI en los mensajes', () => {
    expect(taparDatos('no se pudo mandar a juana@mail.com (+54 9 11 5555-1234), DNI 30123456')).toBe(
      'no se pudo mandar a [email] ([número]), DNI [número]',
    );
    // Los ids y códigos cortos quedan.
    expect(taparDatos('turno 3f2a-9b1c falló en la línea 42')).toBe('turno 3f2a-9b1c falló en la línea 42');
  });

  it('saca cuerpo, cookies, headers de sesión, IP y query de la request', () => {
    const e = limpiarEvento({
      type: undefined,
      message: 'error con pepe@club.test',
      request: {
        url: 'https://x.test/public/reservas/abc?token=secreto',
        data: { cliente: { telefono: '1155551234' } },
        cookies: { cancheria_sesion: 'x' },
        query_string: 'token=secreto',
        headers: { cookie: 'cancheria_sesion=x', 'user-agent': 'Firefox', 'x-forwarded-for': '1.2.3.4' },
      },
      user: { ip_address: '1.2.3.4' },
      exception: { values: [{ type: 'Error', value: 'falló para 11 5555-1234' }] },
      breadcrumbs: [{ message: 'mail a ana@x.test', data: { body: 'x' } }],
    } as ErrorEvent);
    expect(e.request).toEqual({
      url: 'https://x.test/public/reservas/abc',
      headers: { 'user-agent': 'Firefox' },
    });
    expect(e.user).toBeUndefined();
    expect(e.message).toBe('error con [email]');
    expect(e.exception?.values?.[0]?.value).toBe('falló para [número]');
    expect(e.breadcrumbs?.[0]).toEqual({ message: 'mail a [email]' });
  });
});
