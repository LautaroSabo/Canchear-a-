import * as Sentry from '@sentry/node';

/**
 * Aviso de errores en producción (Sentry). Sin `dsn` no hace nada: en desarrollo y en los
 * tests los errores solo van al log. Se reportan solo los errores inesperados (500, tareas
 * del worker que fallan, excepciones sin atrapar), nunca los de negocio (turno ocupado, etc.).
 */
export interface AvisoErrores {
  capturar(err: unknown, contexto?: Record<string, string | number | undefined>): void;
  /** Espera a que salgan los avisos pendientes (antes de apagar). */
  cerrar(): Promise<void>;
}

export const SIN_AVISO: AvisoErrores = { capturar: () => {}, cerrar: async () => {} };

export function iniciarAvisoErrores(o: {
  dsn?: string | undefined;
  /** api, worker o web. */
  servicio: string;
  entorno?: string | undefined;
  version?: string | undefined;
}): AvisoErrores {
  if (!o.dsn) return SIN_AVISO;
  Sentry.init({
    dsn: o.dsn,
    environment: o.entorno ?? 'production',
    ...(o.version ? { release: o.version } : {}),
    serverName: o.servicio,
    initialScope: { tags: { servicio: o.servicio } },
    // Sin performance ni instrumentación automática: solo errores.
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.contextLinesIntegration(),
    ],
    beforeSend: (evento) => limpiarEvento(evento),
  });
  const repetido = limitadorDeRepetidos();
  return {
    capturar(err, contexto) {
      if (repetido(err, contexto)) return;
      Sentry.withScope((scope) => {
        for (const [k, v] of Object.entries(contexto ?? {})) if (v !== undefined) scope.setTag(k, String(v));
        Sentry.captureException(err);
      });
    },
    async cerrar() {
      await Sentry.close(3000);
    },
  };
}

/**
 * true si el mismo error (mismo mensaje y mismo contexto) ya se avisó hace menos de
 * `ventanaMs`: una tarea que falla cada minuto no agota el cupo gratis de Sentry.
 */
export function limitadorDeRepetidos(ventanaMs = 10 * 60_000, reloj: () => number = Date.now) {
  const ultimos = new Map<string, number>();
  return (err: unknown, contexto?: Record<string, unknown>) => {
    const mensaje = err instanceof Error ? `${err.name}:${err.message}` : String(err);
    const clave = `${mensaje}|${JSON.stringify(contexto ?? {})}`;
    const ahora = reloj();
    const antes = ultimos.get(clave);
    if (antes !== undefined && ahora - antes < ventanaMs) return true;
    if (ultimos.size > 1000) ultimos.clear();
    ultimos.set(clave, ahora);
    return false;
  };
}

const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi;
// Teléfonos y DNI: 7 o más dígitos seguidos (con o sin +, espacios o guiones de por medio).
const NUMERO_LARGO = /\+?\d[\d\s-]{6,}\d/g;

export function taparDatos(texto: string): string {
  return texto.replace(EMAIL, '[email]').replace(NUMERO_LARGO, '[número]');
}

/**
 * Lo que sale hacia Sentry no lleva datos personales: ni cuerpo de la request (nombres,
 * teléfonos), ni cookies, ni headers de sesión, ni IP; y se tapan emails y números largos que
 * hayan quedado en los mensajes de error.
 */
export function limpiarEvento<E extends Sentry.ErrorEvent>(evento: E): E {
  if (evento.request) {
    delete evento.request.data;
    delete evento.request.cookies;
    delete evento.request.query_string;
    if (evento.request.headers) {
      const { 'user-agent': ua, 'content-type': ct } = evento.request.headers;
      evento.request.headers = { ...(ua ? { 'user-agent': ua } : {}), ...(ct ? { 'content-type': ct } : {}) };
    }
    if (evento.request.url) evento.request.url = evento.request.url.split('?')[0] ?? '';
  }
  delete evento.user;
  if (evento.message) evento.message = taparDatos(evento.message);
  for (const ex of evento.exception?.values ?? []) {
    if (ex.value) ex.value = taparDatos(ex.value);
  }
  for (const b of evento.breadcrumbs ?? []) {
    if (b.message) b.message = taparDatos(b.message);
    delete b.data;
  }
  return evento;
}
