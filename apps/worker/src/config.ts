import { z } from 'zod';

const esquema = z.object({
  DATABASE_URL: z.string().min(1),
  CLAVE_CREDENCIALES: z.string().min(1),
  URL_WEB: z.string().url().default('http://localhost:3000'),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export function cargarConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = esquema.parse(env);
  const whatsapp =
    e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID
      ? { token: e.WHATSAPP_TOKEN, phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID }
      : null;
  if (!whatsapp && e.NODE_ENV === 'production') {
    throw new Error('En producción hacen falta WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID');
  }
  return {
    databaseUrl: e.DATABASE_URL,
    claveCredenciales: e.CLAVE_CREDENCIALES,
    urlWeb: e.URL_WEB,
    whatsapp,
    nivelLog: e.LOG_LEVEL,
    logsLegibles: e.NODE_ENV === 'development',
    intervalos: {
      expiracionMs: 30_000,
      notificacionesMs: 5_000,
      reembolsosMs: 30_000,
      listaEsperaMs: 15 * 60_000,
    },
  };
}
