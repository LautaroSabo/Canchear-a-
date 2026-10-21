import {
  alcanzaRol,
  ErrorNegocio,
  type Rol,
  type ServicioAuth,
  type UsuarioSesion,
} from '@cancheria/servicios';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: UsuarioSesion;
    rol?: Rol;
  }
  interface FastifyContextConfig {
    /** Rol mínimo para una ruta del panel (por defecto RECEPCION). */
    rolMinimo?: Rol;
  }
}

export const COOKIE_SESION = 'cancheria_sesion';
export const HEADER_CSRF = 'x-cancheria-csrf';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF: la cookie de sesión es SameSite=Lax y, además, toda request que modifica algo
 * tiene que traer este header. Un sitio ajeno no puede agregarlo sin un preflight de
 * CORS, y el preflight solo se acepta desde los orígenes del front.
 */
export async function exigirCsrf(req: FastifyRequest) {
  if (!METODOS_SEGUROS.has(req.method) && req.headers[HEADER_CSRF] !== '1') {
    throw new ErrorNegocio(403, 'CSRF', `Falta el header ${HEADER_CSRF}`);
  }
}

export function exigirSesion(auth: ServicioAuth) {
  return async (req: FastifyRequest) => {
    const usuario = await auth.sesion(req.cookies[COOKIE_SESION]);
    if (!usuario) throw new ErrorNegocio(401, 'NO_AUTENTICADO', 'Iniciá sesión');
    req.usuario = usuario;
  };
}

const paramsClub = z.object({ clubId: z.uuid() });

/**
 * El usuario tiene que ser miembro del club de la URL y tener el rol que pide la ruta.
 * Si no es miembro se responde 404, igual que si el club no existiera.
 */
export function exigirRolEnClub(auth: ServicioAuth) {
  return async (req: FastifyRequest) => {
    const usuario = req.usuario;
    if (!usuario) throw new ErrorNegocio(401, 'NO_AUTENTICADO', 'Iniciá sesión');
    const parsed = paramsClub.safeParse(req.params);
    const rol = parsed.success ? await auth.rolEnClub(usuario.id, parsed.data.clubId) : null;
    if (!rol) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
    const minimo = req.routeOptions.config.rolMinimo ?? 'RECEPCION';
    if (!alcanzaRol(rol, minimo)) {
      throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', `Hace falta el rol ${minimo} o superior`);
    }
    req.rol = rol;
  };
}

export const clubIdDe = (req: FastifyRequest) => paramsClub.parse(req.params).clubId;

export function usuarioDe(req: FastifyRequest): UsuarioSesion {
  if (!req.usuario) throw new ErrorNegocio(401, 'NO_AUTENTICADO', 'Iniciá sesión');
  return req.usuario;
}

export function setCookieSesion(reply: FastifyReply, token: string, expiraEn: Date, seguras: boolean) {
  reply.setCookie(COOKIE_SESION, token, {
    httpOnly: true,
    secure: seguras,
    sameSite: 'lax',
    path: '/admin',
    expires: expiraEn,
  });
}
