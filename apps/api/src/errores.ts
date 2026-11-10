import { type AvisoErrores, ErrorNegocio, SIN_AVISO } from '@cancheria/servicios';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export { ErrorNegocio } from '@cancheria/servicios';

export interface CuerpoError {
  error: { codigo: string; mensaje: string; detalle?: unknown };
}

/** Errores 500 al log y, si está configurado, al aviso de errores. Los de negocio no se avisan. */
export function crearManejadorErrores(aviso: AvisoErrores = SIN_AVISO) {
  const avisar = (error: unknown, request: FastifyRequest) =>
    aviso.capturar(error, {
      metodo: request.method,
      // La plantilla de la ruta (/public/reservas/:codigo), nunca la URL con el código o los datos.
      ruta: request.routeOptions?.url ?? 'desconocida',
    });
  return (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) =>
    manejadorErrores(error, request, reply, avisar);
}

export function manejadorErrores(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
  avisar: (error: unknown, request: FastifyRequest) => void = () => {},
) {
  if (error instanceof ErrorNegocio) {
    if (error.status >= 500) {
      request.log.error({ err: error, causa: error.cause }, error.codigo);
      avisar(error, request);
    }
    return reply.status(error.status).send({
      error: { codigo: error.codigo, mensaje: error.message, detalle: error.detalle },
    } satisfies CuerpoError);
  }
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        codigo: 'VALIDACION',
        mensaje: 'Datos inválidos',
        detalle: error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
      },
    } satisfies CuerpoError);
  }
  const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  if (status < 500) {
    // Errores propios de Fastify/plugins: JSON mal formado, rate limit, etc.
    const codigo =
      status === 429
        ? 'DEMASIADAS_SOLICITUDES'
        : status === 413
          ? 'ARCHIVO_DEMASIADO_GRANDE'
          : 'SOLICITUD_INVALIDA';
    return reply.status(status).send({ error: { codigo, mensaje: error.message } } satisfies CuerpoError);
  }
  request.log.error({ err: error }, 'error no controlado');
  avisar(error, request);
  return reply
    .status(500)
    .send({ error: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno' } } satisfies CuerpoError);
}
