/**
 * Error esperable del dominio: la API lo responde tal cual con su status y código.
 * `detalle` es público (va en la respuesta); `causa` es interna (solo a los logs).
 */
export class ErrorNegocio extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
    readonly detalle?: unknown,
    causa?: unknown,
  ) {
    super(mensaje, causa === undefined ? undefined : { cause: causa });
  }
}
