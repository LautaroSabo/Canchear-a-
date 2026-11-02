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
  /** Proxies delante de la API (el del hosting). 0 en local; 1 en Railway, Render, etc. */
  /**
   * Ruta de la cookie del panel tal como la ve el navegador: /admin si la API tiene su
   * propio dominio; /api/admin si la web la sirve en /api (mismo dominio, sin comprar uno).
   */
  COOKIE_RUTA: z.string().startsWith('/').default('/admin'),
  PROXIES_CONFIABLES: z.coerce.number().int().min(0).max(5).default(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  /** Abono mensual de la plataforma, en pesos (se muestra a cada club en su panel). */
  ABONO_MENSUAL: z.coerce.number().int().min(0).optional(),
  /** Cómo pagar el abono (alias, CBU, link): texto libre que ve cada club. */
  ABONO_COMO_PAGAR: z.string().optional(),
  /** Adónde avisar cuando se registra un club (por ejemplo, tu Gmail). */
  AVISOS_EMAIL: z.email().optional(),
  /** Envío por Resend (HTTPS): recomendado, anda en hostings que bloquean SMTP. */
  RESEND_API_KEY: z.string().optional(),
  /** O por SMTP: con Gmail, smtp.gmail.com, puerto 465 y una contraseña de aplicación. */
  SMTP_HOST: z.string().optional(),
  SMTP_PUERTO: z.coerce.number().int().positive().default(465),
  SMTP_USUARIO: z.string().optional(),
  SMTP_CONTRASENA: z.string().optional(),
  /** Remitente, por ejemplo "Canchería <avisos@tudominio.com.ar>" (opcional). */
  CORREO_REMITENTE: z.string().optional(),
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
  proxiesConfiables: number;
  rutaCookie: string;
  nivelLog: z.infer<typeof esquema>['LOG_LEVEL'];
  logsLegibles: boolean;
  /** Cookie de sesión con Secure (HTTPS). Siempre en producción. */
  cookiesSeguras: boolean;
  /** Reservas públicas por IP y minuto. */
  reservasPorMinuto: number;
  /** Intentos de login al panel por IP y minuto (fuerza bruta). */
  loginsPorMinuto: number;
  /** Cuánto se cachea la configuración de un club (canchas, tarifas, reglas). */
  cacheClubMs: number;
  /** No se puede reservar un turno que empieza en menos de esto. */
  anticipacionMinimaMin: number;
  /** Hasta cuántos días adelante se muestra la grilla pública. */
  diasMaximosAnticipacion: number;
  /**
   * El worker (con el mismo entorno) manda por WhatsApp. Sin esto los mensajes solo se
   * imprimen en su consola; el panel lo avisa.
   */
  whatsappConfigurado: boolean;
  /** Abono mensual en centavos, o null si no se configuró. */
  abonoMensual: number | null;
  comoPagarAbono: string | null;
  /** Destinatario de los avisos internos (registro de clubes). */
  avisosEmail: string | null;
  correo: {
    resendApiKey?: string | undefined;
    remitente?: string | undefined;
    smtp?: { host: string; puerto: number; usuario: string; contrasena: string } | undefined;
  };
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
    proxiesConfiables: e.PROXIES_CONFIABLES,
    rutaCookie: e.COOKIE_RUTA,
    nivelLog: e.LOG_LEVEL,
    // Logs con colores solo en una terminal de desarrollo; en el hosting, JSON.
    logsLegibles: e.NODE_ENV === 'development' && Boolean(process.stdout.isTTY),
    // Publicada detrás de HTTPS la cookie va siempre con Secure, aunque no se defina NODE_ENV.
    cookiesSeguras: e.NODE_ENV === 'production' || e.URL_API.startsWith('https://'),
    whatsappConfigurado: Boolean(e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID),
    abonoMensual: e.ABONO_MENSUAL !== undefined ? e.ABONO_MENSUAL * 100 : null,
    comoPagarAbono: e.ABONO_COMO_PAGAR?.trim() || null,
    avisosEmail: e.AVISOS_EMAIL ?? null,
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
    reservasPorMinuto: 10,
    loginsPorMinuto: 10,
    cacheClubMs: 10_000,
    anticipacionMinimaMin: 0,
    diasMaximosAnticipacion: 30,
  };
}
