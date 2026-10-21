import { randomBytes } from 'node:crypto';
import {
  aMinutos,
  diaSemana,
  generarSlots,
  partesLocales,
  sumarDias,
  ventanasDeJornada,
} from '@cancheria/core';
import { type Tx, violaUnique } from '@cancheria/db';
import {
  canchas,
  clubs,
  configuracionExpiracion,
  diasEspeciales,
  horariosApertura,
  miembrosClub,
  tarifas,
  usuarios,
} from '@cancheria/db/schema';
import { and, asc, eq, gte, ne, sql } from 'drizzle-orm';
import { type Rol, ServicioAuth } from './auth.ts';
import type { ConfigClub, RepoClubs } from './config-club.ts';
import { cotizarTurno } from './cotizacion.ts';
import type { Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';

// --- Tipos de entrada (la API los valida con Zod antes) -----------------------

export interface DatosClub {
  nombre?: string | undefined;
  telefono?: string | null | undefined;
  direccion?: string | null | undefined;
  minutosRevisionTransferencia?: number | undefined;
}

export interface DatosCancha {
  nombre: string;
  jugadoresPorLado: number;
  superficie: 'SINTETICO' | 'CESPED_NATURAL' | 'CEMENTO' | 'PARQUET' | 'OTRO';
  techada: boolean;
  iluminacion: boolean;
  duracionTurnoMin: 30 | 60 | 90 | 120;
  orden: number;
  activa: boolean;
}

export interface DatosTarifa {
  canchaId: string | null;
  diaSemana: number | null;
  horaDesde: string;
  horaHasta: string;
  precio: number;
  etiqueta: string | null;
  vigenteDesde: string;
  vigenteHasta: string | null;
}

export interface FranjaApertura {
  diaSemana: number;
  abre: string;
  cierra: string;
}

export interface DatosDiaEspecial {
  cerrado: boolean;
  abre: string | null;
  cierra: string | null;
  motivo: string | null;
}

export interface DatosRegla {
  nombre: string;
  canchaId: string | null;
  diaSemana: number | null;
  horaDesde: string | null;
  horaHasta: string | null;
  requiereSena: boolean;
  tipoSena: 'PORCENTAJE' | 'MONTO_FIJO';
  valorSena: number;
  minutosExpiracion: number;
  margenMinAntesInicio: number;
  prioridad: number;
  activa: boolean;
}

export interface AvisoConfiguracion {
  nivel: 'error' | 'advertencia';
  mensaje: string;
}

// --- Franjas horarias -----------------------------------------------------------

/** Franja [desde, hasta) en minutos del día; "hasta" <= "desde" cruza la medianoche. */
function intervalosDeFranja(desde: string, hasta: string): [number, number][] {
  const d = aMinutos(desde);
  const h = aMinutos(hasta) || 24 * 60;
  return d < h
    ? [[d, h]]
    : [
        [d, 24 * 60],
        [0, h],
      ];
}

const seSolapan = (a: [number, number][], b: [number, number][]) =>
  a.some(([a0, a1]) => b.some(([b0, b1]) => a0 < b1 && b0 < a1));

const vigenciasSeSolapan = (a: DatosTarifa, b: DatosTarifa) =>
  (a.vigenteHasta === null || b.vigenteDesde <= a.vigenteHasta) &&
  (b.vigenteHasta === null || a.vigenteDesde <= b.vigenteHasta);

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Valida la semana de apertura completa: cada franja dura entre 1 minuto y 24 h, y
 * ninguna se pisa con otra, contando la madrugada que una franja nocturna le quita al
 * día siguiente (sábado 09:00–02:00 choca con un domingo que abre a la 01:00).
 */
export function validarSemana(franjas: FranjaApertura[]) {
  const SEMANA = 7 * 24 * 60;
  const absolutas = franjas.map((f) => {
    const abre = aMinutos(f.abre);
    const cierra = aMinutos(f.cierra);
    const duracion = cierra > abre ? cierra - abre : cierra + 24 * 60 - abre;
    const inicio = f.diaSemana * 24 * 60 + abre;
    return { f, inicio, fin: inicio + duracion };
  });
  for (const [i, a] of absolutas.entries()) {
    for (const b of absolutas.slice(i + 1)) {
      // También se compara corriendo una semana (el sábado nocturno contra el domingo).
      const choca = [-SEMANA, 0, SEMANA].some((d) => a.inicio < b.fin + d && b.inicio + d < a.fin);
      if (choca) {
        throw new ErrorNegocio(
          422,
          'HORARIOS_SUPERPUESTOS',
          `El horario del ${DIAS[a.f.diaSemana]} (${a.f.abre}–${a.f.cierra}) se pisa con el del ${DIAS[b.f.diaSemana]} (${b.f.abre}–${b.f.cierra})`,
        );
      }
    }
  }
}

// --- Avisos -------------------------------------------------------------------

/**
 * Lo que está mal configurado y el dueño no vería de otro modo: la grilla pública oculta
 * los horarios sin tarifa, y una seña sin medio de pago deja a los clientes sin poder pagar.
 */
export function avisosDeConfiguracion(cfg: ConfigClub, hoy: string): AvisoConfiguracion[] {
  const avisos: AvisoConfiguracion[] = [];
  if (cfg.canchas.length === 0) {
    avisos.push({
      nivel: 'error',
      mensaje: 'No hay canchas activas: la página pública no muestra nada para reservar.',
    });
  }
  if (cfg.horarios.length === 0) {
    avisos.push({
      nivel: 'error',
      mensaje: 'No cargaste horarios de apertura: la grilla pública está vacía.',
    });
  }

  // Una pasada por cada día de la semana, con fechas reales (las vigencias importan).
  for (let i = 0; i < 7; i++) {
    const fecha = sumarDias(hoy, i);
    const ventanas = ventanasDeJornada(fecha, cfg.club.zonaHoraria, cfg.horarios);
    for (const cancha of cfg.canchas) {
      const sinPrecio = generarSlots(ventanas, cancha.duracionTurnoMin).filter(
        (s) => !cotizarTurno(cfg, cancha, s.inicio),
      );
      if (sinPrecio.length === 0) continue;
      // Agrupa turnos consecutivos en rangos ("00:00–02:00").
      const rangos: [number, number][] = [];
      for (const s of sinPrecio) {
        const ini = partesLocales(s.inicio, cfg.club.zonaHoraria).minutos;
        const fin = ini + cancha.duracionTurnoMin;
        const ultimo = rangos.at(-1);
        if (ultimo && ultimo[1] === ini) ultimo[1] = fin;
        else rangos.push([ini, fin]);
      }
      avisos.push({
        nivel: 'error',
        mensaje: `${cancha.nombre} · ${DIAS_PLURAL[diaSemana(fecha)]} ${rangos
          .map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`)
          .join(', ')} sin precio: esos turnos no se muestran al público.`,
      });
    }
  }

  const pideSena = cfg.reglas.some((r) => r.requiereSena && r.valorSena > 0);
  if (pideSena && !cfg.mediosPago.mercadoPago && !cfg.mediosPago.transferencia) {
    avisos.push({
      nivel: 'error',
      mensaje:
        'Hay reglas que piden seña pero no configuraste Mercado Pago ni transferencia: nadie va a poder pagarla.',
    });
  }
  if (!cfg.club.telefono) {
    avisos.push({
      nivel: 'advertencia',
      mensaje:
        'Cargá el teléfono del club: se muestra a quien quiere reservar un turno que está por empezar.',
    });
  }
  return avisos;
}

// --- Servicio -------------------------------------------------------------------

export class ServicioConfiguracion {
  private readonly auth: ServicioAuth;

  constructor(private readonly e: Entorno & { clubs: RepoClubs }) {
    this.auth = new ServicioAuth(e);
  }

  /** Todo lo editable del club (incluidas canchas y reglas inactivas) más los avisos. */
  async leer(clubId: string) {
    const [club] = await this.e.db
      .select({
        id: clubs.id,
        slug: clubs.slug,
        nombre: clubs.nombre,
        telefono: clubs.telefono,
        direccion: clubs.direccion,
        zonaHoraria: clubs.zonaHoraria,
        minutosRevisionTransferencia: clubs.minutosRevisionTransferencia,
      })
      .from(clubs)
      .where(eq(clubs.id, clubId));
    if (!club) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
    const hoy = partesLocales(this.e.reloj(), club.zonaHoraria).fecha;

    const [listaCanchas, listaTarifas, horarios, especiales, reglas, cfg] = await Promise.all([
      this.e.db
        .select()
        .from(canchas)
        .where(eq(canchas.clubId, clubId))
        .orderBy(asc(canchas.orden), asc(canchas.nombre)),
      this.e.db
        .select()
        .from(tarifas)
        .where(eq(tarifas.clubId, clubId))
        .orderBy(asc(tarifas.canchaId), asc(tarifas.diaSemana), asc(tarifas.horaDesde)),
      this.e.db
        .select({
          diaSemana: horariosApertura.diaSemana,
          abre: horariosApertura.abre,
          cierra: horariosApertura.cierra,
        })
        .from(horariosApertura)
        .where(eq(horariosApertura.clubId, clubId))
        .orderBy(asc(horariosApertura.diaSemana), asc(horariosApertura.abre)),
      this.e.db
        .select()
        .from(diasEspeciales)
        .where(and(eq(diasEspeciales.clubId, clubId), gte(diasEspeciales.fecha, sumarDias(hoy, -1))))
        .orderBy(asc(diasEspeciales.fecha)),
      this.e.db
        .select()
        .from(configuracionExpiracion)
        .where(eq(configuracionExpiracion.clubId, clubId))
        .orderBy(sql`${configuracionExpiracion.prioridad} DESC`, asc(configuracionExpiracion.nombre)),
      this.e.clubs.porId(clubId),
    ]);

    const corta = (t: string | null) => (t ? t.slice(0, 5) : t);
    return {
      club,
      canchas: listaCanchas.map(({ clubId: _c, ...c }) => c),
      tarifas: listaTarifas.map(({ clubId: _c, ...t }) => ({
        ...t,
        horaDesde: corta(t.horaDesde),
        horaHasta: corta(t.horaHasta),
      })),
      horarios: horarios.map((h) => ({ ...h, abre: corta(h.abre), cierra: corta(h.cierra) })),
      diasEspeciales: especiales.map(({ clubId: _c, ...d }) => ({
        ...d,
        abre: corta(d.abre),
        cierra: corta(d.cierra),
      })),
      reglas: reglas.map(({ clubId: _c, ...r }) => ({
        ...r,
        horaDesde: corta(r.horaDesde),
        horaHasta: corta(r.horaHasta),
      })),
      avisos: cfg ? avisosDeConfiguracion(cfg, hoy) : [],
    };
  }

  async actualizarClub(clubId: string, datos: DatosClub) {
    await this.escribir(clubId, (tx) =>
      tx
        .update(clubs)
        .set({
          ...(datos.nombre !== undefined ? { nombre: datos.nombre } : {}),
          ...(datos.telefono !== undefined ? { telefono: datos.telefono } : {}),
          ...(datos.direccion !== undefined ? { direccion: datos.direccion } : {}),
          ...(datos.minutosRevisionTransferencia !== undefined
            ? { minutosRevisionTransferencia: datos.minutosRevisionTransferencia }
            : {}),
        })
        .where(eq(clubs.id, clubId)),
    );
  }

  // --- Canchas ---------------------------------------------------------------

  async crearCancha(clubId: string, datos: DatosCancha) {
    return this.escribir(
      clubId,
      async (tx) => {
        const [c] = await tx
          .insert(canchas)
          .values({ clubId, ...datos })
          .returning({ id: canchas.id });
        return c;
      },
      'cancha',
    );
  }

  /** Las canchas no se borran (tienen turnos e historial): se desactivan. */
  async actualizarCancha(
    clubId: string,
    canchaId: string,
    datos: { [K in keyof DatosCancha]?: DatosCancha[K] | undefined },
  ) {
    if (Object.values(datos).every((v) => v === undefined)) return;
    await this.escribir(
      clubId,
      async (tx) => {
        const filas = await tx
          .update(canchas)
          .set(datos)
          .where(and(eq(canchas.id, canchaId), eq(canchas.clubId, clubId)))
          .returning({ id: canchas.id });
        if (filas.length === 0) throw new ErrorNegocio(404, 'CANCHA_NO_ENCONTRADA', 'No existe esa cancha');
      },
      'cancha',
    );
  }

  // --- Tarifas ----------------------------------------------------------------

  async crearTarifa(clubId: string, datos: DatosTarifa) {
    return this.escribir(clubId, async (tx) => {
      await this.validarTarifa(tx, clubId, datos, null);
      const [t] = await tx
        .insert(tarifas)
        .values({ clubId, ...datos })
        .returning({ id: tarifas.id });
      return t;
    });
  }

  async actualizarTarifa(clubId: string, tarifaId: string, datos: DatosTarifa) {
    await this.escribir(clubId, async (tx) => {
      await this.validarTarifa(tx, clubId, datos, tarifaId);
      const filas = await tx
        .update(tarifas)
        .set(datos)
        .where(and(eq(tarifas.id, tarifaId), eq(tarifas.clubId, clubId)))
        .returning({ id: tarifas.id });
      if (filas.length === 0) throw new ErrorNegocio(404, 'TARIFA_NO_ENCONTRADA', 'No existe esa tarifa');
    });
  }

  async borrarTarifa(clubId: string, tarifaId: string) {
    await this.escribir(clubId, async (tx) => {
      const filas = await tx
        .delete(tarifas)
        .where(and(eq(tarifas.id, tarifaId), eq(tarifas.clubId, clubId)))
        .returning({ id: tarifas.id });
      if (filas.length === 0) throw new ErrorNegocio(404, 'TARIFA_NO_ENCONTRADA', 'No existe esa tarifa');
    });
  }

  /**
   * Dos tarifas con el mismo alcance (misma cancha o ambas generales, mismo día o ambas
   * "todos los días") no pueden cubrir el mismo horario en el mismo período: el precio
   * sería ambiguo. Con distinto alcance sí (gana la más específica).
   */
  private async validarTarifa(tx: Tx, clubId: string, t: DatosTarifa, excluir: string | null) {
    if (t.vigenteHasta !== null && t.vigenteHasta < t.vigenteDesde) {
      throw new ErrorNegocio(422, 'VIGENCIA_INVALIDA', 'La vigencia termina antes de empezar');
    }
    if (t.horaDesde === t.horaHasta)
      throw new ErrorNegocio(422, 'FRANJA_INVALIDA', 'La franja no puede durar 0 minutos');
    if (t.horaHasta !== '00:00' && t.horaHasta < t.horaDesde)
      throw new ErrorNegocio(
        422,
        'FRANJA_INVALIDA',
        'Una tarifa no puede cruzar la medianoche: cargá una hasta las 00:00 y otra desde las 00:00 del día siguiente',
      );
    if (t.canchaId) await this.canchaDelClub(tx, clubId, t.canchaId);
    const otras = await tx
      .select()
      .from(tarifas)
      .where(and(eq(tarifas.clubId, clubId), excluir ? ne(tarifas.id, excluir) : undefined));
    const choque = otras.find(
      (o) =>
        o.canchaId === t.canchaId &&
        o.diaSemana === t.diaSemana &&
        seSolapan(
          intervalosDeFranja(o.horaDesde, o.horaHasta),
          intervalosDeFranja(t.horaDesde, t.horaHasta),
        ) &&
        vigenciasSeSolapan(o as DatosTarifa, t),
    );
    if (choque) {
      throw new ErrorNegocio(
        409,
        'TARIFA_SUPERPUESTA',
        `Se pisa con la tarifa de ${choque.horaDesde.slice(0, 5)} a ${choque.horaHasta.slice(0, 5)}${choque.etiqueta ? ` (${choque.etiqueta})` : ''}`,
        { tarifaId: choque.id },
      );
    }
  }

  // --- Horarios ---------------------------------------------------------------

  /** Reemplaza la semana completa de apertura en una sola transacción. */
  async reemplazarHorarios(clubId: string, franjas: FranjaApertura[]) {
    validarSemana(franjas);
    await this.escribir(clubId, async (tx) => {
      await tx.delete(horariosApertura).where(eq(horariosApertura.clubId, clubId));
      if (franjas.length) await tx.insert(horariosApertura).values(franjas.map((f) => ({ clubId, ...f })));
    });
  }

  async guardarDiaEspecial(clubId: string, fecha: string, d: DatosDiaEspecial) {
    if (!d.cerrado && (!d.abre || !d.cierra)) {
      throw new ErrorNegocio(
        422,
        'HORARIO_INCOMPLETO',
        'Si el club abre ese día, indicá desde y hasta qué hora',
      );
    }
    await this.escribir(clubId, (tx) =>
      tx
        .insert(diasEspeciales)
        .values({ clubId, fecha, ...d, abre: d.cerrado ? null : d.abre, cierra: d.cerrado ? null : d.cierra })
        .onConflictDoUpdate({
          target: [diasEspeciales.clubId, diasEspeciales.fecha],
          set: {
            cerrado: d.cerrado,
            abre: d.cerrado ? null : d.abre,
            cierra: d.cerrado ? null : d.cierra,
            motivo: d.motivo,
          },
        }),
    );
  }

  async borrarDiaEspecial(clubId: string, fecha: string) {
    await this.escribir(clubId, (tx) =>
      tx
        .delete(diasEspeciales)
        .where(and(eq(diasEspeciales.clubId, clubId), eq(diasEspeciales.fecha, fecha))),
    );
  }

  // --- Reglas de seña ---------------------------------------------------------

  async crearRegla(clubId: string, r: DatosRegla) {
    this.validarRegla(r);
    return this.escribir(clubId, async (tx) => {
      if (r.canchaId) await this.canchaDelClub(tx, clubId, r.canchaId);
      const [fila] = await tx
        .insert(configuracionExpiracion)
        .values({ clubId, ...r })
        .returning({ id: configuracionExpiracion.id });
      return fila;
    });
  }

  async actualizarRegla(clubId: string, reglaId: string, r: DatosRegla) {
    this.validarRegla(r);
    await this.escribir(clubId, async (tx) => {
      if (r.canchaId) await this.canchaDelClub(tx, clubId, r.canchaId);
      const filas = await tx
        .update(configuracionExpiracion)
        .set(r)
        .where(and(eq(configuracionExpiracion.id, reglaId), eq(configuracionExpiracion.clubId, clubId)))
        .returning({ id: configuracionExpiracion.id });
      if (filas.length === 0) throw new ErrorNegocio(404, 'REGLA_NO_ENCONTRADA', 'No existe esa regla');
    });
  }

  async borrarRegla(clubId: string, reglaId: string) {
    await this.escribir(clubId, async (tx) => {
      const filas = await tx
        .delete(configuracionExpiracion)
        .where(and(eq(configuracionExpiracion.id, reglaId), eq(configuracionExpiracion.clubId, clubId)))
        .returning({ id: configuracionExpiracion.id });
      if (filas.length === 0) throw new ErrorNegocio(404, 'REGLA_NO_ENCONTRADA', 'No existe esa regla');
    });
  }

  private validarRegla(r: DatosRegla) {
    if ((r.horaDesde === null) !== (r.horaHasta === null)) {
      throw new ErrorNegocio(422, 'FRANJA_INCOMPLETA', 'Indicá las dos horas de la franja, o ninguna');
    }
    if (r.tipoSena === 'PORCENTAJE' && r.valorSena > 100) {
      throw new ErrorNegocio(422, 'PORCENTAJE_INVALIDO', 'El porcentaje de seña va de 0 a 100');
    }
  }

  // --- Usuarios del club --------------------------------------------------------

  async usuarios(clubId: string) {
    return this.e.db
      .select({
        id: usuarios.id,
        email: usuarios.email,
        nombre: usuarios.nombre,
        activo: usuarios.activo,
        rol: miembrosClub.rol,
      })
      .from(miembrosClub)
      .innerJoin(usuarios, eq(usuarios.id, miembrosClub.usuarioId))
      .where(eq(miembrosClub.clubId, clubId))
      .orderBy(asc(usuarios.nombre));
  }

  /**
   * Suma a alguien al club. Si el email ya tiene cuenta (de este u otro club) se le
   * asigna el rol; si no, se crea con una contraseña generada que se muestra una vez.
   */
  async invitar(clubId: string, datos: { email: string; nombre: string; rol: Rol }) {
    const email = datos.email.trim().toLowerCase();
    const [existente] = await this.e.db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.email, email));
    let contrasenaGenerada: string | null = null;
    let usuarioId = existente?.id;
    if (!usuarioId) {
      contrasenaGenerada = randomBytes(9).toString('base64url');
      usuarioId = (
        await this.auth.crearUsuario({ email, nombre: datos.nombre, contrasena: contrasenaGenerada })
      ).id;
    } else {
      const [miembro] = await this.e.db
        .select({ rol: miembrosClub.rol })
        .from(miembrosClub)
        .where(and(eq(miembrosClub.clubId, clubId), eq(miembrosClub.usuarioId, usuarioId)));
      if (miembro) throw new ErrorNegocio(409, 'YA_ES_MIEMBRO', 'Esa persona ya tiene acceso a este club');
    }
    await this.auth.asignarRol(clubId, usuarioId, datos.rol);
    return { usuarioId, contrasenaGenerada };
  }

  async cambiarRol(clubId: string, usuarioId: string, rol: Rol) {
    await this.escribir(clubId, async (tx) => {
      await this.noDejarSinDueno(tx, clubId, usuarioId, rol);
      const filas = await tx
        .update(miembrosClub)
        .set({ rol })
        .where(and(eq(miembrosClub.clubId, clubId), eq(miembrosClub.usuarioId, usuarioId)))
        .returning({ id: miembrosClub.usuarioId });
      if (filas.length === 0)
        throw new ErrorNegocio(404, 'USUARIO_NO_ENCONTRADO', 'Esa persona no es del club');
    });
  }

  /** Le saca el acceso al club y cierra sus sesiones (si no tiene otros clubs). */
  async quitar(clubId: string, usuarioId: string) {
    await this.escribir(clubId, async (tx) => {
      await this.noDejarSinDueno(tx, clubId, usuarioId, null);
      const filas = await tx
        .delete(miembrosClub)
        .where(and(eq(miembrosClub.clubId, clubId), eq(miembrosClub.usuarioId, usuarioId)))
        .returning({ id: miembrosClub.usuarioId });
      if (filas.length === 0)
        throw new ErrorNegocio(404, 'USUARIO_NO_ENCONTRADO', 'Esa persona no es del club');
    });
    if ((await this.auth.clubsDe(usuarioId)).length === 0) await this.auth.cerrarSesiones(usuarioId);
  }

  /** Un club siempre tiene al menos un dueño (si no, nadie podría cambiar las credenciales). */
  private async noDejarSinDueno(tx: Tx, clubId: string, usuarioId: string, rolNuevo: Rol | null) {
    if (rolNuevo === 'OWNER') return;
    const duenos = await tx
      .select({ id: miembrosClub.usuarioId })
      .from(miembrosClub)
      .where(and(eq(miembrosClub.clubId, clubId), eq(miembrosClub.rol, 'OWNER')));
    if (duenos.length === 1 && duenos[0]?.id === usuarioId) {
      throw new ErrorNegocio(
        409,
        'ULTIMO_DUENO',
        'El club se quedaría sin dueño: primero nombrá a otra persona como dueña',
      );
    }
  }

  // ---------------------------------------------------------------------------

  private async canchaDelClub(tx: Tx, clubId: string, canchaId: string) {
    const [c] = await tx
      .select({ id: canchas.id })
      .from(canchas)
      .where(and(eq(canchas.id, canchaId), eq(canchas.clubId, clubId)));
    if (!c) throw new ErrorNegocio(404, 'CANCHA_NO_ENCONTRADA', 'La cancha no existe en este club');
  }

  /**
   * Escrituras de configuración de un club: serializadas con un lock sobre la fila del
   * club (dos admins editando tarifas a la vez no pueden dejar dos que se pisen) y, al
   * terminar, la caché de configuración se invalida para que el público lo vea ya.
   */
  private async escribir<T>(clubId: string, fn: (tx: Tx) => Promise<T>, entidad?: 'cancha'): Promise<T> {
    try {
      const r = await this.e.db.transaction(async (tx) => {
        const [club] = await tx
          .select({ id: clubs.id })
          .from(clubs)
          .where(eq(clubs.id, clubId))
          .for('update');
        if (!club) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
        return fn(tx);
      });
      this.e.clubs.invalidar();
      return r;
    } catch (err) {
      if (entidad === 'cancha' && violaUnique(err)) {
        throw new ErrorNegocio(409, 'NOMBRE_EN_USO', 'Ya hay una cancha con ese nombre');
      }
      throw err;
    }
  }
}
