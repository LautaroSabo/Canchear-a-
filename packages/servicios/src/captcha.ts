/**
 * Captcha de los formularios públicos que se pueden abusar con robots (registrar club,
 * olvidé mi contraseña, inscripción a torneos, lista de espera). Cloudflare Turnstile:
 * gratis y casi siempre invisible. Sin clave configurada no se pide.
 */
export interface VerificadorCaptcha {
  readonly activo: boolean;
  verificar(token: string | undefined, ip?: string): Promise<boolean>;
}

export const SIN_CAPTCHA: VerificadorCaptcha = { activo: false, verificar: async () => true };

export class CaptchaTurnstile implements VerificadorCaptcha {
  readonly activo = true;
  constructor(
    private readonly secreto: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async verificar(token: string | undefined, ip?: string) {
    if (!token || token.length > 2048) return false;
    const cuerpo = new URLSearchParams({
      secret: this.secreto,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    });
    try {
      const res = await this.fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: cuerpo,
        signal: AbortSignal.timeout(8_000),
      });
      const r = (await res.json()) as { success?: boolean };
      return r.success === true;
    } catch {
      // Si Cloudflare no responde, no se bloquea a la gente: los límites por IP siguen.
      return true;
    }
  }
}

/** Para tests: acepta solo el token "ok". */
export class CaptchaFalso implements VerificadorCaptcha {
  readonly activo = true;
  async verificar(token: string | undefined) {
    return token === 'ok';
  }
}
