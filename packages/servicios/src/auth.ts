import { createHash, randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from 'node:crypto';
import { violaUnique } from '@cancheria/db';
import { clubs, miembrosClub, sesiones, usuarios } from '@cancheria/db/schema';
import { and, eq, gt, lt, ne } from 'drizzle-orm';
import type { Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';

export type Rol = 'OWNER' | 'ADMIN' | 'RECEPCION';

const JERARQUIA: Record<Rol, number> = { RECEPCION: 1, ADMIN: 2, OWNER: 3 };

/** ¿`rol` alcanza para algo que pide `minimo`? OWNER > ADMIN > RECEPCION. */
export const alcanzaRol = (rol: Rol, minimo: Rol) => JERARQUIA[rol] >= JERARQUIA[minimo];

// --- Contraseñas (scrypt, incluido en Node: sin dependencias nativas) ---------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } satisfies ScryptOptions;
const LARGO = 32;
export const LARGO_MINIMO_CONTRASENA = 10;

const derivar = (contrasena: string, sal: Buffer, o: ScryptOptions = SCRYPT) =>
  new Promise<Buffer>((ok, mal) =>
    scrypt(contrasena.normalize('NFKC'), sal, LARGO, o, (e, k) => (e ? mal(e) : ok(k))),
  );

/** Formato: scrypt$N$r$p$sal$hash (base64). Los parámetros viajan con el hash para poder subirlos después. */
export async function hashContrasena(contrasena: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await derivar(contrasena, sal);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, sal.toString('base64'), hash.toString('base64')].join('$');
}

export async function verificarContrasena(contrasena: string, almacenado: string): Promise<boolean> {
  const [alg, n, r, p, sal, hash] = almacenado.split('$');
  if (alg !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const calculado = await derivar(contrasena, Buffer.from(sal, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

/** Hash de una contraseña que nadie conoce: se verifica contra él cuando el email no existe. */
let hashFicticio: Promise<string> | undefined;

// --- Sesiones -----------------------------------------------------------------

const DURACION_SESION_MS = 7 * 24 * 60 * 60_000;
/** Las sesiones en uso se renuevan, como mucho, una vez por hora. */
const RENOVAR_CADA_MS = 60 * 60_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest();

export interface UsuarioSesion {
  id: string;
  email: string;
  nombre: string;
  sesionId: string;
  expiraEn: Date;
}

export interface ClubDelUsuario {
  id: string;
  slug: string;
  nombre: string;
  /** El panel muestra todas las horas en la zona del club, no en la del navegador. */
  zonaHoraria: string;
  rol: Rol;
}

export class ServicioAuth {
  constructor(private readonly e: Pick<Entorno, 'db' | 'reloj'>) {}

  /**
   * Devuelve un token nuevo (va en la cookie). El mensaje de error es el mismo exista o
   * no el email, y se calcula scrypt igual, para no revelar qué emails tienen cuenta.
   */
  async login(
    email: string,
    contrasena: string,
    meta: { ip?: string | undefined; userAgent?: string | undefined } = {},
  ) {
    const [u] = await this.e.db.select().from(usuarios).where(eq(usuarios.email, email.trim().toLowerCase()));
    hashFicticio ??= hashContrasena(randomBytes(16).toString('hex'));
    const ok = await verificarContrasena(contrasena, u?.passwordHash ?? (await hashFicticio));
    if (!u || !ok || !u.activo) {
      throw new ErrorNegocio(401, 'CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos');
    }

    const token = randomBytes(32).toString('base64url');
    const expiraEn = new Date(this.e.reloj().getTime() + DURACION_SESION_MS);
    await this.e.db.insert(sesiones).values({
      usuarioId: u.id,
      tokenHash: hashToken(token),
      expiraEn,
      renovadaEn: this.e.reloj(),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    return { token, expiraEn, usuario: { id: u.id, email: u.email, nombre: u.nombre } };
  }

  /** Usuario de una sesión vigente (sliding: se extiende mientras se use). */
  async sesion(token: string | undefined): Promise<UsuarioSesion | null> {
    if (!token) return null;
    const ahora = this.e.reloj();
    const [f] = await this.e.db
      .select({
        sesionId: sesiones.id,
        expiraEn: sesiones.expiraEn,
        renovadaEn: sesiones.renovadaEn,
        id: usuarios.id,
        email: usuarios.email,
        nombre: usuarios.nombre,
      })
      .from(sesiones)
      .innerJoin(usuarios, eq(usuarios.id, sesiones.usuarioId))
      .where(
        and(
          eq(sesiones.tokenHash, hashToken(token)),
          gt(sesiones.expiraEn, ahora),
          eq(usuarios.activo, true),
        ),
      );
    if (!f) return null;

    let { expiraEn } = f;
    if (ahora.getTime() - f.renovadaEn.getTime() > RENOVAR_CADA_MS) {
      expiraEn = new Date(ahora.getTime() + DURACION_SESION_MS);
      await this.e.db
        .update(sesiones)
        .set({ expiraEn, renovadaEn: ahora })
        .where(eq(sesiones.id, f.sesionId));
    }
    return { id: f.id, email: f.email, nombre: f.nombre, sesionId: f.sesionId, expiraEn };
  }

  async logout(token: string | undefined) {
    if (token) await this.e.db.delete(sesiones).where(eq(sesiones.tokenHash, hashToken(token)));
  }

  /** Cierra todas las sesiones de un usuario (cambio de contraseña, baja). */
  async cerrarSesiones(usuarioId: string) {
    await this.e.db.delete(sesiones).where(eq(sesiones.usuarioId, usuarioId));
  }

  /** Cambia la contraseña y cierra todas las demás sesiones (la actual sigue abierta). */
  async cambiarContrasena(usuarioId: string, sesionId: string, actual: string, nueva: string) {
    const [u] = await this.e.db
      .select({ hash: usuarios.passwordHash })
      .from(usuarios)
      .where(eq(usuarios.id, usuarioId));
    if (!u || !(await verificarContrasena(actual, u.hash))) {
      throw new ErrorNegocio(422, 'CONTRASENA_ACTUAL_INCORRECTA', 'La contraseña actual no es correcta');
    }
    if (nueva.length < LARGO_MINIMO_CONTRASENA) {
      throw new ErrorNegocio(
        422,
        'CONTRASENA_CORTA',
        `La contraseña tiene que tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres`,
      );
    }
    await this.e.db.transaction(async (tx) => {
      await tx
        .update(usuarios)
        .set({ passwordHash: await hashContrasena(nueva) })
        .where(eq(usuarios.id, usuarioId));
      await tx.delete(sesiones).where(and(eq(sesiones.usuarioId, usuarioId), ne(sesiones.id, sesionId)));
    });
  }

  async purgarVencidas() {
    const borradas = await this.e.db
      .delete(sesiones)
      .where(lt(sesiones.expiraEn, this.e.reloj()))
      .returning({ id: sesiones.id });
    return borradas.length;
  }

  async clubsDe(usuarioId: string): Promise<ClubDelUsuario[]> {
    return this.e.db
      .select({
        id: clubs.id,
        slug: clubs.slug,
        nombre: clubs.nombre,
        zonaHoraria: clubs.zonaHoraria,
        rol: miembrosClub.rol,
      })
      .from(miembrosClub)
      .innerJoin(clubs, eq(clubs.id, miembrosClub.clubId))
      .where(eq(miembrosClub.usuarioId, usuarioId))
      .orderBy(clubs.nombre);
  }

  async rolEnClub(usuarioId: string, clubId: string): Promise<Rol | null> {
    const [m] = await this.e.db
      .select({ rol: miembrosClub.rol })
      .from(miembrosClub)
      .where(and(eq(miembrosClub.usuarioId, usuarioId), eq(miembrosClub.clubId, clubId)));
    return m?.rol ?? null;
  }

  async crearUsuario(datos: { email: string; nombre: string; contrasena: string }) {
    if (datos.contrasena.length < LARGO_MINIMO_CONTRASENA) {
      throw new ErrorNegocio(
        422,
        'CONTRASENA_CORTA',
        `La contraseña tiene que tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres`,
      );
    }
    try {
      const [u] = await this.e.db
        .insert(usuarios)
        .values({
          email: datos.email.trim().toLowerCase(),
          nombre: datos.nombre,
          passwordHash: await hashContrasena(datos.contrasena),
        })
        .returning({ id: usuarios.id, email: usuarios.email, nombre: usuarios.nombre });
      if (!u) throw new Error('insert de usuario sin filas');
      return u;
    } catch (err) {
      if (violaUnique(err)) throw new ErrorNegocio(409, 'EMAIL_EN_USO', 'Ya existe un usuario con ese email');
      throw err;
    }
  }

  async asignarRol(clubId: string, usuarioId: string, rol: Rol) {
    await this.e.db
      .insert(miembrosClub)
      .values({ clubId, usuarioId, rol })
      .onConflictDoUpdate({ target: [miembrosClub.clubId, miembrosClub.usuarioId], set: { rol } });
  }
}
