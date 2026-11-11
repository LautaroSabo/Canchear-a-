import { describe, expect, it } from 'vitest';
import { CaptchaTurnstile } from '../src/captcha.ts';

const respuesta = (cuerpo: unknown) =>
  (async () => new Response(JSON.stringify(cuerpo))) as unknown as typeof fetch;

describe('captcha Turnstile', () => {
  it('manda secreto, token e IP y respeta la respuesta de Cloudflare', async () => {
    let enviado = '';
    const fetchFn = (async (_url: string, init: RequestInit) => {
      enviado = String(init.body);
      return new Response(JSON.stringify({ success: true }));
    }) as unknown as typeof fetch;
    expect(await new CaptchaTurnstile('secreto', fetchFn).verificar('tok', '1.2.3.4')).toBe(true);
    expect(enviado).toBe('secret=secreto&response=tok&remoteip=1.2.3.4');
    expect(await new CaptchaTurnstile('s', respuesta({ success: false })).verificar('tok')).toBe(false);
  });

  it('sin token no pasa; si Cloudflare no responde, no bloquea', async () => {
    expect(await new CaptchaTurnstile('s', respuesta({ success: true })).verificar(undefined)).toBe(false);
    const caido = (async () => {
      throw new Error('timeout');
    }) as unknown as typeof fetch;
    expect(await new CaptchaTurnstile('s', caido).verificar('tok')).toBe(true);
  });
});
