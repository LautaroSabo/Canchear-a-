import { ErrorNegocio, type VerificadorCaptcha } from '@cancheria/servicios';
import type { FastifyRequest } from 'fastify';

/** El front manda el token de Turnstile en este header. */
export const HEADER_CAPTCHA = 'x-captcha';

/** preHandler: si el captcha está configurado, la request tiene que traer un token válido. */
export const exigirCaptcha = (captcha: VerificadorCaptcha) => async (req: FastifyRequest) => {
  if (!captcha.activo) return;
  const token = req.headers[HEADER_CAPTCHA];
  if (!(await captcha.verificar(Array.isArray(token) ? token[0] : token, req.ip))) {
    throw new ErrorNegocio(
      400,
      'CAPTCHA_INVALIDO',
      'No pudimos confirmar que no sos un robot. Esperá a que aparezca el tilde y probá de nuevo.',
    );
  }
};
