import type { Instrumentation } from 'next';

// Aviso de errores del servidor de Next (páginas que fallan al armarse). Mismo DSN que la API;
// sin SENTRY_DSN no hace nada. Solo se manda el error y la ruta del archivo de la página
// (/[slug]/page), nunca la URL con el código de la reserva ni datos del usuario.

type Sentry = typeof import('@sentry/node');
let sentry: Sentry | null = null;
const avisados = new Map<string, number>();

export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || process.env.NEXT_RUNTIME !== 'nodejs') return;
  const s = await import('@sentry/node');
  s.init({
    dsn,
    environment: 'production',
    ...(process.env.RAILWAY_GIT_COMMIT_SHA ? { release: process.env.RAILWAY_GIT_COMMIT_SHA } : {}),
    serverName: 'web',
    initialScope: { tags: { servicio: 'web' } },
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [s.linkedErrorsIntegration(), s.dedupeIntegration()],
    beforeSend(evento) {
      delete evento.request;
      delete evento.user;
      for (const ex of evento.exception?.values ?? []) {
        if (ex.value)
          ex.value = ex.value
            .replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, '[email]')
            .replace(/\+?\d[\d\s-]{6,}\d/g, '[número]');
      }
      return evento;
    },
  });
  sentry = s;
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (!sentry) return;
  // Una página que falla en cada visita se avisa una vez cada 10 minutos.
  const clave = `${context.routePath}|${err instanceof Error ? err.message : String(err)}`;
  const antes = avisados.get(clave);
  if (antes && Date.now() - antes < 10 * 60_000) return;
  if (avisados.size > 1000) avisados.clear();
  avisados.set(clave, Date.now());
  const s = sentry;
  s.withScope((scope) => {
    scope.setTag('metodo', request.method);
    scope.setTag('ruta', context.routePath);
    scope.setTag('tipo', context.routeType);
    s.captureException(err);
  });
  await s.flush(2000);
};
