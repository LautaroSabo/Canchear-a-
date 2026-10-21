import { randomUUID } from 'node:crypto';
import { crearClubDemo, crearDb } from '@cancheria/db';
import { Cifrador, guardarCredencialesMp, type Rol, ServicioAuth } from '@cancheria/servicios';
import { AlmacenMemoria, PasarelaMpFalsa } from '@cancheria/servicios/testing';
import { inject } from 'vitest';
import { construirApp } from '../src/app.ts';
import { cargarConfig } from '../src/config.ts';

/** Viernes 2030-01-04 12:00 en Buenos Aires. */
export const AHORA = new Date('2030-01-04T12:00:00-03:00');
/** Fecha/hora local de Buenos Aires → ISO con offset, como lo manda el front. */
export const ba = (fecha: string, hora: string) => `${fecha}T${hora}:00-03:00`;
export const iso = (fecha: string, hora: string) => new Date(ba(fecha, hora)).toISOString();

/**
 * App completa contra la base de test, con un club demo propio (slug aleatorio) y un
 * reloj controlable. Misma config que producción salvo caché y rate limit.
 */
export async function crearContexto({
  pool = 10,
  loginsPorMinuto = 10_000,
}: {
  pool?: number;
  loginsPorMinuto?: number;
} = {}) {
  const url = inject('databaseUrl');
  const conexion = crearDb(url, { max: pool });
  let ahora = AHORA;
  const clave = Cifrador.generarClave();
  const config = {
    ...cargarConfig({
      DATABASE_URL: url,
      NODE_ENV: 'test',
      CLAVE_CREDENCIALES: clave,
      URL_WEB: 'https://cancheria.test',
      URL_API: 'https://api.cancheria.test',
    }),
    cacheClubMs: 0,
    reservasPorMinuto: 10_000,
    loginsPorMinuto,
  };
  const pasarela = new PasarelaMpFalsa();
  const almacen = new AlmacenMemoria();
  const app = await construirApp({
    db: conexion.db,
    cliente: conexion.cliente,
    config,
    reloj: () => ahora,
    logger: false,
    pasarela,
    almacen,
  });
  const slug = `club-${randomUUID().slice(0, 8)}`;
  const { club, canchas } = await crearClubDemo(conexion.db, slug);
  await guardarCredencialesMp(conexion.db, new Cifrador(clave), club.id, {
    accessToken: 'TEST-token',
    webhookSecret: 'secreto-webhook',
  });
  const [f5a, f5b, f7] = canchas;

  return {
    app,
    db: conexion.db,
    club,
    slug,
    pasarela,
    almacen,
    canchas: { f5a, f5b, f7 },
    setAhora: (d: Date) => {
      ahora = d;
    },
    cerrar: async () => {
      await app.close();
      await conexion.cerrar();
    },
  };
}

export type Contexto = Awaited<ReturnType<typeof crearContexto>>;

let contador = 0;
export function pedido(
  canchaId: string,
  inicio: string,
  cliente: Partial<{ nombre: string; telefono: string; dni: string }> = {},
) {
  contador++;
  return {
    canchaId,
    inicio,
    cliente: {
      nombre: `Jugador ${contador}`,
      telefono: `+54911${String(50_000_000 + contador)}`,
      ...cliente,
    },
    idempotencyKey: randomUUID(),
  };
}

export function reservar(ctx: Contexto, cuerpo: ReturnType<typeof pedido>) {
  return ctx.app.inject({ method: 'POST', url: `/public/clubs/${ctx.slug}/reservas`, payload: cuerpo });
}

/** Cuerpo multipart con un solo archivo, como lo arma un <input type="file">. */
export function multipart(campo: string, nombre: string, tipo: string, datos: Buffer) {
  const limite = `----cancheria${randomUUID()}`;
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${limite}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${limite}\r\nContent-Disposition: form-data; name="${campo}"; filename="${nombre}"\r\nContent-Type: ${tipo}\r\n\r\n`,
      ),
      datos,
      Buffer.from(`\r\n--${limite}--\r\n`),
    ]),
  };
}

export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

/** Usuario del panel con un rol en el club del contexto, ya logueado: devuelve su cookie. */
export async function usuarioPanel(ctx: Contexto, rol: Rol, clubId = ctx.club.id) {
  const auth = new ServicioAuth({ db: ctx.db, reloj: () => new Date() });
  const email = `${rol.toLowerCase()}-${randomUUID().slice(0, 8)}@club.test`;
  const u = await auth.crearUsuario({ email, nombre: `Usuario ${rol}`, contrasena: 'contrasena-de-prueba' });
  await auth.asignarRol(clubId, u.id, rol);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    headers: { 'x-cancheria-csrf': '1' },
    payload: { email, contrasena: 'contrasena-de-prueba' },
  });
  const cookie = res.cookies.find((c) => c.name === 'cancheria_sesion');
  if (!cookie) throw new Error(`login falló: ${res.body}`);
  return { usuario: u, email, cookie: `cancheria_sesion=${cookie.value}` };
}

/** Request al panel con sesión y header CSRF. */
export function panel(
  ctx: Contexto,
  cookie: string,
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
  ruta: string,
  payload?: unknown,
) {
  return ctx.app.inject({
    method: metodo,
    url: `/admin/clubs/${ctx.club.id}${ruta}`,
    headers: { cookie, 'x-cancheria-csrf': '1' },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}
