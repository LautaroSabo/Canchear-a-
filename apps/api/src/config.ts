import { z } from 'zod';

const esquema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  /** Origen(es) del front habilitados por CORS, separados por coma. */
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export interface Config {
  databaseUrl: string;
  puerto: number;
  host: string;
  origenesWeb: string[];
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
    nivelLog: e.LOG_LEVEL,
    logsLegibles: e.NODE_ENV === 'development',
    reservasPorMinuto: 10,
    cacheClubMs: 10_000,
    anticipacionMinimaMin: 0,
    diasMaximosAnticipacion: 30,
  };
}
