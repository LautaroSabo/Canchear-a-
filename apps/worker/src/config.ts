import { z } from 'zod';

const esquema = z.object({
  DATABASE_URL: z.string().min(1),
  CLAVE_CREDENCIALES: z.string().min(1),
  URL_WEB: z.url().default('http://localhost:3000'),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  /** Avisos por mail al cliente (los mismos que usa la API para avisarte a vos). */
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PUERTO: z.coerce.number().int().positive().default(465),
  SMTP_USUARIO: z.string().optional(),
  SMTP_CONTRASENA: z.string().optional(),
  CORREO_REMITENTE: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Aviso de errores (Sentry): el mismo DSN que la API. */
  SENTRY_DSN: z.url().optional(),
  /** Días después del vencimiento del abono hasta suspender el club solo. */
  DIAS_GRACIA_ABONO: z.coerce.number().int().min(0).max(60).default(5),
  /** "1" prende la suspensión automática por abono vencido (apagada por defecto). */
  SUSPENSION_AUTOMATICA: z.enum(['0', '1']).default('0'),
});

export function cargarConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = esquema.parse(env);
  const whatsapp =
    e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID
      ? { token: e.WHATSAPP_TOKEN, phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID }
      : null;
  return {
    databaseUrl: e.DATABASE_URL,
    claveCredenciales: e.CLAVE_CREDENCIALES,
    urlWeb: e.URL_WEB,
    whatsapp,
    correo: {
      resendApiKey: e.RESEND_API_KEY,
      remitente: e.CORREO_REMITENTE,
      smtp:
        e.SMTP_HOST && e.SMTP_USUARIO && e.SMTP_CONTRASENA
          ? {
              host: e.SMTP_HOST,
              puerto: e.SMTP_PUERTO,
              usuario: e.SMTP_USUARIO,
              contrasena: e.SMTP_CONTRASENA,
            }
          : undefined,
    },
    /** En desarrollo, un medio sin configurar imprime el aviso en la consola. */
    desarrollo: e.NODE_ENV !== 'production',
    nivelLog: e.LOG_LEVEL,
    sentryDsn: e.SENTRY_DSN,
    suspension: e.SUSPENSION_AUTOMATICA === '1' ? { diasGracia: e.DIAS_GRACIA_ABONO } : null,
    logsLegibles: e.NODE_ENV === 'development' && Boolean(process.stdout.isTTY),
    intervalos: {
      expiracionMs: 30_000,
      notificacionesMs: 5_000,
      reembolsosMs: 30_000,
      listaEsperaMs: 15 * 60_000,
      sesionesMs: 6 * 60 * 60_000,
      turnosFijosMs: 60 * 60_000,
      recordatoriosMs: 5 * 60_000,
      partidosTorneoMs: 15 * 60_000,
      abonosVencidosMs: 6 * 60 * 60_000,
    },
  };
}
