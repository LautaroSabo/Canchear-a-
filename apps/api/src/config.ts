import { z } from 'zod';

const esquema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  /** Origen(es) del front habilitados por CORS, separados por coma. */
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  /** URL pública del front (links en mensajes y retorno desde Mercado Pago). */
  URL_WEB: z.url().default('http://localhost:3000'),
  /** URL pública de esta API (Mercado Pago le manda los webhooks acá). */
  URL_API: z.url().default('http://localhost:3001'),
  /** Clave AES-256 (32 bytes en base64) con la que se cifran las credenciales de MP. */
  CLAVE_CREDENCIALES: z.string().min(1),
  /** Carpeta local para comprobantes de transferencia (en producción: S3/R2). */
  DIR_COMPROBANTES: z.string().default('./uploads'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export interface Config {
  databaseUrl: string;
  puerto: number;
  host: string;
  origenesWeb: string[];
  urlWeb: string;
  urlApi: string;
  claveCredenciales: string;
  dirComprobantes: string;
  nivelLog: z.infer<typeof esquema>['LOG_LEVEL'];
  logsLegibles: boolean;
  /** Reservas públicas por IP y minuto. */
  reservasPorMinuto: number;
  /** Cuánto se cachea la configuración de un club (canchas, tarifas, reglas). */
  cacheClubMs: number;
  /** No se puede reservar un turno que empieza en menos de esto. */
  anticipacionMinimaMin: number;
  /** Hasta cuántos días adelante se muestra la grilla pública. */
  diasMaximosAnticipacion: number;
}

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = esquema.parse(env);
  return {
    databaseUrl: e.DATABASE_URL,
    puerto: e.PORT,
    host: e.HOST,
    origenesWeb: e.WEB_ORIGIN.split(',').map((o) => o.trim()),
    urlWeb: e.URL_WEB,
    urlApi: e.URL_API,
    claveCredenciales: e.CLAVE_CREDENCIALES,
    dirComprobantes: e.DIR_COMPROBANTES,
    nivelLog: e.LOG_LEVEL,
    logsLegibles: e.NODE_ENV === 'development',
    reservasPorMinuto: 10,
    cacheClubMs: 10_000,
    anticipacionMinimaMin: 0,
    diasMaximosAnticipacion: 30,
  };
}
