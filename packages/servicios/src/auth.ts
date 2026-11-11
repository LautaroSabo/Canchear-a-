import { createHash, randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from 'node:crypto';
import { violaUnique } from '@cancheria/db';
import {
  clubs,
  desafiosDosPasos,
  miembrosClub,
  restablecimientos,
  sesiones,
  usuarios,
} from '@cancheria/db/schema';
import { and, eq, gt, isNull, lt, ne } from 'drizzle-orm';
import type { Ejecutor, Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';
import { nuevoSecretoTotp, uriTotp, verificarTotp } from './totp.ts';

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

const DURACION_RESTABLECIMIENTO_MS = 60 * 60_000;

const DURACION_DESAFIO_MS = 5 * 60_000;
const INTENTOS_DESAFIO = 5;
const CODIGOS_RECUPERACION = 8;

/** "K7QM-2XPV": sin letras que se confunden (0/O, 1/I/L). */
function nuevoCodigoRecuperacion() {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = randomBytes(8);
  const c = Array.from(b, (x) => letras[x % letras.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}
const hashRecuperacion = (codigo: string) =>
  createHash('sha256')
    .update(codigo.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .digest('hex');

export interface UsuarioSesion {
  id: string;
  email: string;
  nombre: string;
  /** Administra la plataforma: aprueba clubes y registra abonos. */
  esSuperadmin: boolean;
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
  estado: 'PENDIENTE' | 'ACTIVO' | 'SUSPENDIDO';
  motivoSuspension: string | null;
  abonoHasta: string | null;
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
    // Con verificación en dos pasos: todavía no hay sesión, falta el código del celular.
    if (u.totpActivoDesde) {
      const desafio = randomBytes(32).toString('base64url');
      await this.e.db.delete(desafiosDosPasos).where(lt(desafiosDosPasos.expiraEn, this.e.reloj()));
      await this.e.db.insert(desafiosDosPasos).values({
        usuarioId: u.id,
        tokenHash: hashToken(desafio),
        expiraEn: new Date(this.e.reloj().getTime() + DURACION_DESAFIO_MS),
      });
      return { dosPasos: true as const, desafio, token: undefined };
    }
    return this.abrirSesion(u, meta);
  }

  private async abrirSesion(
    u: { id: string; email: string; nombre: string; esSuperadmin: boolean },
    meta: { ip?: string | undefined; userAgent?: string | undefined },
    db: Ejecutor = this.e.db,
  ) {
    const token = randomBytes(32).toString('base64url');
    const expiraEn = new Date(this.e.reloj().getTime() + DURACION_SESION_MS);
    await db.insert(sesiones).values({
      usuarioId: u.id,
      tokenHash: hashToken(token),
      expiraEn,
      renovadaEn: this.e.reloj(),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    return {
      dosPasos: false as const,
      token,
      expiraEn,
      usuario: { id: u.id, email: u.email, nombre: u.nombre, esSuperadmin: u.esSuperadmin },
    };
  }

  /**
   * Segundo paso del login: el código de la app autenticadora (o uno de recuperación).
   * Cada desafío dura 5 minutos y admite 5 intentos; después hay que volver a poner la
   * contraseña (que tiene su propio límite de intentos).
   */
  async loginDosPasos(
    desafio: string,
    codigo: string,
    meta: { ip?: string | undefined; userAgent?: string | undefined } = {},
  ) {
    const ahora = this.e.reloj();
    const r = await this.e.db.transaction(async (tx) => {
      const [d] = await tx
        .select()
        .from(desafiosDosPasos)
        .where(and(eq(desafiosDosPasos.tokenHash, hashToken(desafio)), gt(desafiosDosPasos.expiraEn, ahora)))
        .for('update');
      if (!d || d.intentos >= INTENTOS_DESAFIO) {
        throw new ErrorNegocio(
          401,
          'DESAFIO_VENCIDO',
          'Se venció el tiempo para poner el código. Volvé a entrar.',
        );
      }
      const [u] = await tx.select().from(usuarios).where(eq(usuarios.id, d.usuarioId)).for('update');
      if (!u?.activo || !u.totpSecreto || !u.totpActivoDesde) {
        throw new ErrorNegocio(401, 'DESAFIO_VENCIDO', 'Volvé a entrar.');
      }
      const paso = verificarTotp(u.totpSecreto, codigo, ahora, u.totpUltimoPaso ?? null);
      const recuperacion = paso === null ? hashRecuperacion(codigo) : null;
      const usaRecuperacion = recuperacion !== null && u.codigosRecuperacion.includes(recuperacion);
      if (paso === null && !usaRecuperacion) {
        await tx
          .update(desafiosDosPasos)
          .set({ intentos: d.intentos + 1 })
          .where(eq(desafiosDosPasos.id, d.id));
        // El intento fallido queda guardado (se confirma la transacción) y recién después se avisa.
        return null;
      }
      await tx
        .update(usuarios)
        .set(
          paso !== null
            ? { totpUltimoPaso: paso }
            : { codigosRecuperacion: u.codigosRecuperacion.filter((c) => c !== recuperacion) },
        )
        .where(eq(usuarios.id, u.id));
      await tx.delete(desafiosDosPasos).where(eq(desafiosDosPasos.id, d.id));
      const sesion = await this.abrirSesion(u, meta, tx);
      return { ...sesion, codigosRestantes: usaRecuperacion ? u.codigosRecuperacion.length - 1 : undefined };
    });
    if (!r) {
      throw new ErrorNegocio(
        401,
        'CODIGO_INVALIDO',
        'El código no es correcto. Fijate el que muestra la app ahora.',
      );
    }
    return r;
  }

  // --- Verificación en dos pasos: activar y desactivar ---------------------------

  async estadoDosPasos(usuarioId: string) {
    const [u] = await this.e.db
      .select({ activo: usuarios.totpActivoDesde, codigos: usuarios.codigosRecuperacion })
      .from(usuarios)
      .where(eq(usuarios.id, usuarioId));
    return {
      activa: Boolean(u?.activo),
      desde: u?.activo ?? null,
      codigosRecuperacion: u?.codigos.length ?? 0,
    };
  }

  /** Genera el secreto (todavía sin activar) para mostrar el QR. */
  async prepararDosPasos(usuarioId: string) {
    const [u] = await this.e.db
      .select({ email: usuarios.email, activo: usuarios.totpActivoDesde })
      .from(usuarios)
      .where(eq(usuarios.id, usuarioId));
    if (!u) throw new ErrorNegocio(404, 'USUARIO_NO_ENCONTRADO', 'No existe ese usuario');
    if (u.activo) throw new ErrorNegocio(409, 'YA_ACTIVA', 'La verificación en dos pasos ya está activada');
    const secreto = nuevoSecretoTotp();
    await this.e.db.update(usuarios).set({ totpSecreto: secreto }).where(eq(usuarios.id, usuarioId));
    return { secreto, uri: uriTotp(secreto, u.email) };
  }

  /** Con el primer código de la app queda activa; devuelve los códigos de recuperación (se ven una vez). */
  async activarDosPasos(usuarioId: string, sesionId: string, codigo: string) {
    const [u] = await this.e.db.select().from(usuarios).where(eq(usuarios.id, usuarioId));
    if (!u?.totpSecreto) throw new ErrorNegocio(409, 'SIN_PREPARAR', 'Primero escaneá el código QR');
    if (u.totpActivoDesde)
      throw new ErrorNegocio(409, 'YA_ACTIVA', 'La verificación en dos pasos ya está activada');
    const paso = verificarTotp(u.totpSecreto, codigo, this.e.reloj(), null);
    if (paso === null) {
      throw new ErrorNegocio(
        422,
        'CODIGO_INVALIDO',
        'El código no es correcto. Fijate que la hora del celular esté bien.',
      );
    }
    const codigos = Array.from({ length: CODIGOS_RECUPERACION }, nuevoCodigoRecuperacion);
    await this.e.db.transaction(async (tx) => {
      await tx
        .update(usuarios)
        .set({
          totpActivoDesde: this.e.reloj(),
          totpUltimoPaso: paso,
          codigosRecuperacion: codigos.map(hashRecuperacion),
        })
        .where(eq(usuarios.id, usuarioId));
      // Las otras sesiones abiertas (sin verificar) se cierran.
      await tx.delete(sesiones).where(and(eq(sesiones.usuarioId, usuarioId), ne(sesiones.id, sesionId)));
    });
    return { codigosRecuperacion: codigos };
  }

  /** Desactivarla pide la contraseña y un código: quien agarra una sesión abierta no puede. */
  async desactivarDosPasos(usuarioId: string, contrasena: string, codigo: string) {
    const [u] = await this.e.db.select().from(usuarios).where(eq(usuarios.id, usuarioId));
    if (!u?.totpActivoDesde || !u.totpSecreto) {
      throw new ErrorNegocio(409, 'NO_ACTIVA', 'La verificación en dos pasos no está activada');
    }
    if (!(await verificarContrasena(contrasena, u.passwordHash))) {
      throw new ErrorNegocio(422, 'CONTRASENA_ACTUAL_INCORRECTA', 'La contraseña no es correcta');
    }
    const okCodigo =
      verificarTotp(u.totpSecreto, codigo, this.e.reloj(), u.totpUltimoPaso ?? null) !== null ||
      u.codigosRecuperacion.includes(hashRecuperacion(codigo));
    if (!okCodigo) throw new ErrorNegocio(422, 'CODIGO_INVALIDO', 'El código no es correcto');
    await this.quitarDosPasos(usuarioId);
  }

  /** Para quien perdió el celular y los códigos (CLI o superadmin). */
  async quitarDosPasos(usuarioId: string) {
    await this.e.db
      .update(usuarios)
      .set({ totpSecreto: null, totpActivoDesde: null, totpUltimoPaso: null, codigosRecuperacion: [] })
      .where(eq(usuarios.id, usuarioId));
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
        esSuperadmin: usuarios.esSuperadmin,
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
    return {
      id: f.id,
      email: f.email,
      nombre: f.nombre,
      esSuperadmin: f.esSuperadmin,
      sesionId: f.sesionId,
      expiraEn,
    };
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

  /**
   * Link de un solo uso (1 hora) para elegir una contraseña nueva. null si el email no
   * tiene una cuenta activa: quien lo pide no se entera (no revela qué emails existen).
   * Anula los links anteriores del mismo usuario.
   */
  async crearRestablecimiento(
    email: string,
  ): Promise<{ token: string; email: string; nombre: string } | null> {
    const [u] = await this.e.db
      .select({ id: usuarios.id, email: usuarios.email, nombre: usuarios.nombre, activo: usuarios.activo })
      .from(usuarios)
      .where(eq(usuarios.email, email.trim().toLowerCase()));
    if (!u?.activo) return null;
    const token = randomBytes(32).toString('base64url');
    await this.e.db.transaction(async (tx) => {
      await tx
        .update(restablecimientos)
        .set({ usadoEn: this.e.reloj() })
        .where(and(eq(restablecimientos.usuarioId, u.id), isNull(restablecimientos.usadoEn)));
      await tx.insert(restablecimientos).values({
        usuarioId: u.id,
        tokenHash: hashToken(token),
        expiraEn: new Date(this.e.reloj().getTime() + DURACION_RESTABLECIMIENTO_MS),
      });
    });
    return { token, email: u.email, nombre: u.nombre };
  }

  /** Contraseña nueva con el link: lo marca usado y cierra todas las sesiones del usuario. */
  async restablecer(token: string, nueva: string) {
    if (nueva.length < LARGO_MINIMO_CONTRASENA) {
      throw new ErrorNegocio(
        422,
        'CONTRASENA_CORTA',
        `La contraseña tiene que tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres`,
      );
    }
    const hash = await hashContrasena(nueva);
    await this.e.db.transaction(async (tx) => {
      const [r] = await tx
        .update(restablecimientos)
        .set({ usadoEn: this.e.reloj() })
        .where(
          and(
            eq(restablecimientos.tokenHash, hashToken(token)),
            isNull(restablecimientos.usadoEn),
            gt(restablecimientos.expiraEn, this.e.reloj()),
          ),
        )
        .returning({ usuarioId: restablecimientos.usuarioId });
      if (!r) {
        throw new ErrorNegocio(
          410,
          'LINK_VENCIDO',
          'Este link ya se usó o venció. Pedí uno nuevo desde "Olvidé mi contraseña".',
        );
      }
      await tx.update(usuarios).set({ passwordHash: hash }).where(eq(usuarios.id, r.usuarioId));
      await tx.delete(sesiones).where(eq(sesiones.usuarioId, r.usuarioId));
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
        estado: clubs.estado,
        motivoSuspension: clubs.motivoSuspension,
        abonoHasta: clubs.abonoHasta,
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
