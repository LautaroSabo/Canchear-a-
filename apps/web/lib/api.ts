/** URL de la API. Va embebida en el build (el navegador le habla directo). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

/** Error de la API con su código de negocio (TURNO_OCUPADO, SIN_SENA, …). */
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
    readonly detalle?: unknown,
  ) {
    super(mensaje);
  }
}

interface Opciones {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  json?: unknown;
  cuerpo?: FormData;
  /** Rutas del panel: cookie de sesión + header CSRF en lo que modifica. */
  panel?: boolean;
  /** SSR: URL base distinta (red interna). */
  base?: string;
  signal?: AbortSignal;
}

export async function pedir<T>(ruta: string, o: Opciones = {}): Promise<T> {
  const metodo = o.metodo ?? 'GET';
  const headers: Record<string, string> = {};
  if (o.json !== undefined) headers['content-type'] = 'application/json';
  if (o.panel && metodo !== 'GET') headers['x-cancheria-csrf'] = '1';

  let res: Response;
  try {
    res = await fetch(`${o.base ?? API_URL}${ruta}`, {
      method: metodo,
      headers,
      body: o.json !== undefined ? JSON.stringify(o.json) : o.cuerpo,
      credentials: o.panel ? 'include' : 'omit',
      cache: 'no-store',
      signal: o.signal ?? null,
    });
  } catch {
    throw new ErrorApi(0, 'SIN_CONEXION', 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.');
  }
  if (res.status === 204) return undefined as T;
  const datos = (await res.json().catch(() => null)) as {
    error?: { codigo: string; mensaje: string; detalle?: unknown };
  } | null;
  if (!res.ok) {
    throw new ErrorApi(
      res.status,
      datos?.error?.codigo ?? 'ERROR',
      datos?.error?.mensaje ?? 'Algo salió mal. Probá de nuevo.',
      datos?.error?.detalle,
    );
  }
  return datos as T;
}

export const panel = {
  get: <T>(ruta: string) => pedir<T>(`/admin${ruta}`, { panel: true }),
  post: <T>(ruta: string, json?: unknown) => pedir<T>(`/admin${ruta}`, { panel: true, metodo: 'POST', json }),
  put: <T>(ruta: string, json?: unknown) => pedir<T>(`/admin${ruta}`, { panel: true, metodo: 'PUT', json }),
  patch: <T>(ruta: string, json?: unknown) =>
    pedir<T>(`/admin${ruta}`, { panel: true, metodo: 'PATCH', json }),
  borrar: <T>(ruta: string) => pedir<T>(`/admin${ruta}`, { panel: true, metodo: 'DELETE' }),
};

export const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo salió mal. Probá de nuevo.');
