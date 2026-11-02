import { afterEach, describe, expect, it, vi } from 'vitest';
import { CorreoResend, CorreoSmtp, crearCorreo } from '../src/correo.ts';

afterEach(() => vi.unstubAllGlobals());

describe('correo', () => {
  it('elige Resend si hay API key, si no SMTP completo, si no nada', () => {
    const smtp = { host: 'smtp.gmail.com', puerto: 465, usuario: 'yo@gmail.com', contrasena: 'clave' };
    expect(crearCorreo({ resendApiKey: 're_x', smtp })).toBeInstanceOf(CorreoResend);
    expect(crearCorreo({ smtp })).toBeInstanceOf(CorreoSmtp);
    expect(crearCorreo({})).toBeNull();
  });

  it('Resend: manda el mail por HTTPS con la API key y falla si la API rechaza', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"id":"1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await new CorreoResend('re_clave').enviar({ para: 'yo@gmail.com', asunto: 'Hola', texto: 'Cuerpo' });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_clave');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Canchería <onboarding@resend.dev>',
      to: ['yo@gmail.com'],
      subject: 'Hola',
      text: 'Cuerpo',
    });

    fetch.mockResolvedValue(new Response('dominio no verificado', { status: 403 }));
    await expect(
      new CorreoResend('re_clave').enviar({ para: 'otro@gmail.com', asunto: 'x', texto: 'x' }),
    ).rejects.toThrow(/403/);
  });
});
