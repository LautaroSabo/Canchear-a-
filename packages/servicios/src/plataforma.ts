import { partesLocales, sumarDias, VERSION_TERMINOS } from '@cancheria/core';
import { violaUnique } from '@cancheria/db';
import { canchas, clubs, miembrosClub, pagosAbono, turnos, usuarios } from '@cancheria/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { hashContrasena, LARGO_MINIMO_CONTRASENA } from './auth.ts';
import { telefonoValido } from './clientes.ts';
import type { Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';

/** La plataforma lleva las fechas del abono en hora argentina. */
const ZONA = 'America/Argentina/Buenos_Aires';

/** Rutas que ya usa la web: un club con ese slug quedaría tapado. */
const SLUGS_RESERVADOS = new Set([
  'panel',
  'r',
  'api',
  'admin',
  'public',
  'webhooks',
  'health',
  'registrar',
  'plataforma',
  'login',
  'terminos',
  'privacidad',
  'clubes',
]);

/** null si el slug sirve; si no, por qué. */
export function problemaSlug(slug: string): string | null {
  if (slug.length < 3 || slug.length > 40) return 'Tiene que tener entre 3 y 40 caracteres';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return 'Solo minúsculas, números y guiones, sin espacios ni acentos (por ejemplo "el-potrero")';
  }
  if (SLUGS_RESERVADOS.has(slug)) return 'Esa dirección está reservada';
  return null;
}

/** "El Potrero F5" → "el-potrero-f5". */
export function slugDesde(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** "2026-01-31" + 1 mes → "2026-02-28" (si el día no existe, el último del mes). */
export function sumarMeses(ymd: string, meses: number): string {
  const [a, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const total = a * 12 + (m - 1) + meses;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${anio}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

export interface DatosRegistro {
  club: { nombre: string; slug: string; telefono: string; direccion?: string | undefined };
  dueno: { nombre: string; email: string; contrasena: string };
  /** Tiene que venir en true: aceptó los Términos y la Política de privacidad. */
  aceptaTerminos: true;
}

export interface ClubPlataforma {
  id: string;
  slug: string;
  nombre: string;
  telefono: string | null;
  direccion: string | null;
  estado: 'PENDIENTE' | 'ACTIVO' | 'SUSPENDIDO';
  creadoEn: Date;
  aprobadoEn: Date | null;
  motivoSuspension: string | null;
  abonoHasta: string | null;
  dueno: { nombre: string; email: string } | null;
  canchas: number;
  turnosUltimos30Dias: number;
}

export class ServicioPlataforma {
  constructor(private readonly e: Pick<Entorno, 'db' | 'reloj'>) {}

  hoy() {
    return partesLocales(this.e.reloj(), ZONA).fecha;
  }

  async slugDisponible(slug: string): Promise<{ disponible: boolean; motivo: string | null }> {
    const problema = problemaSlug(slug);
    if (problema) return { disponible: false, motivo: problema };
    const [c] = await this.e.db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, slug));
    return c
      ? { disponible: false, motivo: 'Ya hay un club con esa dirección' }
      : { disponible: true, motivo: null };
  }

  /**
   * Alta desde la web: el club queda PENDIENTE (se puede configurar y ver, pero no toma
   * reservas) hasta que la plataforma lo aprueba. El dueño se crea con su contraseña.
   */
  async registrar(d: DatosRegistro): Promise<{ clubId: string; usuarioId: string }> {
    const slug = d.club.slug.trim().toLowerCase();
    const problema = problemaSlug(slug);
    if (problema) throw new ErrorNegocio(422, 'SLUG_INVALIDO', `Dirección del club: ${problema}`);
    if (d.dueno.contrasena.length < LARGO_MINIMO_CONTRASENA) {
      throw new ErrorNegocio(
        422,
        'CONTRASENA_CORTA',
        `La contraseña tiene que tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres`,
      );
    }
    const telefono = telefonoValido(d.club.telefono);
    const passwordHash = await hashContrasena(d.dueno.contrasena);
    const email = d.dueno.email.trim().toLowerCase();

    return this.e.db.transaction(async (tx) => {
      const [existeEmail] = await tx
        .select({ id: usuarios.id })
        .from(usuarios)
        .where(eq(usuarios.email, email));
      if (existeEmail) {
        throw new ErrorNegocio(
          409,
          'EMAIL_EN_USO',
          'Ya hay una cuenta con ese email. Entrá al panel con ella o usá otro email.',
        );
      }
      try {
        const [club] = await tx
          .insert(clubs)
          .values({
            slug,
            nombre: d.club.nombre.trim(),
            telefono,
            direccion: d.club.direccion?.trim() || null,
            estado: 'PENDIENTE',
          })
          .returning({ id: clubs.id });
        const [u] = await tx
          .insert(usuarios)
          .values({
            email,
            nombre: d.dueno.nombre.trim(),
            passwordHash,
            terminosVersion: VERSION_TERMINOS,
            terminosAceptadosEn: this.e.reloj(),
          })
          .returning({ id: usuarios.id });
        if (!club || !u) throw new Error('alta sin filas');
        await tx.insert(miembrosClub).values({ clubId: club.id, usuarioId: u.id, rol: 'OWNER' });
        return { clubId: club.id, usuarioId: u.id };
      } catch (err) {
        if (violaUnique(err)) {
          throw new ErrorNegocio(409, 'SLUG_EN_USO', 'Ya hay un club con esa dirección: elegí otra');
        }
        throw err;
      }
    });
  }

  async listar(): Promise<ClubPlataforma[]> {
    const desde = new Date(this.e.reloj().getTime() - 30 * 24 * 60 * 60_000);
    const filas = await this.e.db
      .select({
        id: clubs.id,
        slug: clubs.slug,
        nombre: clubs.nombre,
        telefono: clubs.telefono,
        direccion: clubs.direccion,
        estado: clubs.estado,
        creadoEn: clubs.creadoEn,
        aprobadoEn: clubs.aprobadoEn,
        motivoSuspension: clubs.motivoSuspension,
        abonoHasta: clubs.abonoHasta,
        duenoNombre: sql<string | null>`(
          SELECT u.nombre FROM miembros_club m JOIN usuarios u ON u.id = m.usuario_id
           WHERE m.club_id = clubs.id AND m.rol = 'OWNER' ORDER BY u.creado_en LIMIT 1)`,
        duenoEmail: sql<string | null>`(
          SELECT u.email FROM miembros_club m JOIN usuarios u ON u.id = m.usuario_id
           WHERE m.club_id = clubs.id AND m.rol = 'OWNER' ORDER BY u.creado_en LIMIT 1)`,
        canchas: sql<number>`(SELECT count(*)::int FROM ${canchas} WHERE ${canchas.clubId} = clubs.id AND ${canchas.activa})`,
        turnosUltimos30Dias: sql<number>`(
          SELECT count(*)::int FROM ${turnos}
           WHERE ${turnos.clubId} = clubs.id AND ${turnos.origen} <> 'BLOQUEO'
             AND ${turnos.creadoEn} >= ${desde.toISOString()}::timestamptz)`,
      })
      .from(clubs)
      .where(eq(clubs.activo, true))
      .orderBy(desc(clubs.creadoEn));
    return filas.map(({ duenoNombre, duenoEmail, ...c }) => ({
      ...c,
      dueno: duenoEmail ? { nombre: duenoNombre ?? '', email: duenoEmail } : null,
    }));
  }

  private async club(clubId: string) {
    const [c] = await this.e.db
      .select({ id: clubs.id, estado: clubs.estado, abonoHasta: clubs.abonoHasta })
      .from(clubs)
      .where(and(eq(clubs.id, clubId), eq(clubs.activo, true)));
    if (!c) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
    return c;
  }

  /** Lo habilita para tomar reservas; `diasPrueba` gratis a partir de hoy (si no tenía más). */
  async aprobar(clubId: string, diasPrueba: number) {
    const c = await this.club(clubId);
    if (c.estado !== 'PENDIENTE') {
      throw new ErrorNegocio(409, 'NO_PENDIENTE', 'Ese club ya fue aprobado');
    }
    const prueba = diasPrueba > 0 ? sumarDias(this.hoy(), diasPrueba - 1) : null;
    const abonoHasta =
      [c.abonoHasta, prueba]
        .filter((x): x is string => Boolean(x))
        .sort()
        .at(-1) ?? null;
    await this.e.db
      .update(clubs)
      .set({ estado: 'ACTIVO', aprobadoEn: this.e.reloj(), motivoSuspension: null, abonoHasta })
      .where(eq(clubs.id, clubId));
  }

  async suspender(clubId: string, motivo: string) {
    const c = await this.club(clubId);
    if (c.estado === 'PENDIENTE') {
      throw new ErrorNegocio(409, 'PENDIENTE', 'El club todavía no fue aprobado');
    }
    await this.e.db
      .update(clubs)
      .set({ estado: 'SUSPENDIDO', motivoSuspension: motivo.trim() })
      .where(eq(clubs.id, clubId));
  }

  async reactivar(clubId: string) {
    const c = await this.club(clubId);
    if (c.estado !== 'SUSPENDIDO') {
      throw new ErrorNegocio(409, 'NO_SUSPENDIDO', 'Ese club no está suspendido');
    }
    await this.e.db
      .update(clubs)
      .set({ estado: 'ACTIVO', motivoSuspension: null })
      .where(eq(clubs.id, clubId));
  }

  /**
   * Registra un pago del abono y extiende la cobertura `meses` desde el día siguiente al
   * último cubierto (o desde hoy, si ya estaba vencido).
   */
  async registrarPago(
    clubId: string,
    usuarioId: string,
    p: { meses: number; monto: number; medio: string; nota?: string | undefined },
  ) {
    return this.e.db.transaction(async (tx) => {
      const [c] = await tx
        .select({ abonoHasta: clubs.abonoHasta })
        .from(clubs)
        .where(and(eq(clubs.id, clubId), eq(clubs.activo, true)))
        .for('update');
      if (!c) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
      const hoy = this.hoy();
      const desde = c.abonoHasta && c.abonoHasta >= hoy ? sumarDias(c.abonoHasta, 1) : hoy;
      const hasta = sumarDias(sumarMeses(desde, p.meses), -1);
      const [pago] = await tx
        .insert(pagosAbono)
        .values({
          clubId,
          monto: p.monto,
          meses: p.meses,
          desde,
          hasta,
          medio: p.medio,
          nota: p.nota?.trim() || null,
          registradoPor: usuarioId,
        })
        .returning();
      await tx.update(clubs).set({ abonoHasta: hasta }).where(eq(clubs.id, clubId));
      return pago;
    });
  }

  pagos(clubId: string) {
    return this.e.db
      .select({
        id: pagosAbono.id,
        monto: pagosAbono.monto,
        meses: pagosAbono.meses,
        desde: pagosAbono.desde,
        hasta: pagosAbono.hasta,
        medio: pagosAbono.medio,
        nota: pagosAbono.nota,
        creadoEn: pagosAbono.creadoEn,
      })
      .from(pagosAbono)
      .where(eq(pagosAbono.clubId, clubId))
      .orderBy(desc(pagosAbono.creadoEn));
  }

  /** Marca (o crea) un usuario como superadmin. Para la CLI. */
  async hacerSuperadmin(email: string) {
    const [u] = await this.e.db
      .update(usuarios)
      .set({ esSuperadmin: true })
      .where(eq(usuarios.email, email.trim().toLowerCase()))
      .returning({ id: usuarios.id });
    return u ?? null;
  }
}
