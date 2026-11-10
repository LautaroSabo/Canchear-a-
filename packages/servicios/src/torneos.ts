import { randomInt } from 'node:crypto';
import {
  clasificados,
  diaSemana,
  type FilaTabla,
  instanteLocal,
  partesLocales,
  primeraRonda,
  repartirEnGrupos,
  sumarDias,
  tablaDePosiciones,
  todosContraTodos,
} from '@cancheria/core';
import { esTurnoOcupado, type Tx, violaUnique } from '@cancheria/db';
import {
  canchas,
  clubs,
  ESTADOS_QUE_OCUPAN,
  torneoEquipos,
  torneoPartidos,
  torneos,
  turnos,
} from '@cancheria/db/schema';
import { and, asc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { telefonoValido } from './clientes.ts';
import type { RepoClubs } from './config-club.ts';
import type { Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';
import { fechaCorta, horaCorta } from './formato.ts';
import { encolarNotificacion } from './notificaciones/encolar.ts';
import type { Plantilla } from './notificaciones/plantillas.ts';
import { slugDesde } from './plataforma.ts';
import { insertarTurno, setActor } from './turnos.ts';

/** Hasta dónde se busca lugar para agendar los partidos. */
const HORIZONTE_DIAS = 370;

export interface DatosTorneo {
  nombre: string;
  descripcion?: string | null | undefined;
  jugadoresPorLado: number;
  inscripcionOnline: boolean;
  cantidadGrupos: number;
  idaYVuelta: boolean;
  clasificanPorGrupo: number;
  /** 0 = domingo … 6 = sábado. */
  dias: number[];
  /** "HH:MM". `horaHasta` <= `horaDesde` = termina después de medianoche. */
  horaDesde: string;
  horaHasta: string;
  canchaIds: string[];
  /** YYYY-MM-DD */
  fechaInicio: string;
  duracionMin: number;
}

export interface DatosEquipo {
  nombre: string;
  delegadoNombre: string;
  delegadoTelefono: string;
  /** Para los avisos del torneo (opcional). */
  delegadoEmail?: string | null | undefined;
}

export interface ResultadoCarga {
  golesLocal: number;
  golesVisitante: number;
  penalesLocal?: number | null | undefined;
  penalesVisitante?: number | null | undefined;
}

type Torneo = typeof torneos.$inferSelect;
type Partido = typeof torneoPartidos.$inferSelect;

interface Hueco {
  canchaId: string;
  inicio: Date;
  fin: Date;
  fecha: string;
}

export class ServicioTorneos {
  constructor(private readonly e: Entorno & { clubs: RepoClubs }) {}

  // --- Consultas ---------------------------------------------------------------

  listar(clubId: string) {
    return this.e.db
      .select({
        id: torneos.id,
        nombre: torneos.nombre,
        slug: torneos.slug,
        estado: torneos.estado,
        jugadoresPorLado: torneos.jugadoresPorLado,
        inscripcionOnline: torneos.inscripcionOnline,
        fechaInicio: torneos.fechaInicio,
        equipos: sql<number>`(SELECT count(*)::int FROM torneo_equipos e WHERE e.torneo_id = torneos.id AND e.estado = 'APROBADO')`,
        pendientes: sql<number>`(SELECT count(*)::int FROM torneo_equipos e WHERE e.torneo_id = torneos.id AND e.estado = 'PENDIENTE')`,
      })
      .from(torneos)
      .where(eq(torneos.clubId, clubId))
      .orderBy(sql`${torneos.creadoEn} DESC`);
  }

  async listaPublica(clubSlug: string) {
    const club = await this.clubPorSlug(clubSlug);
    const lista = await this.listar(club.id);
    return lista.map(({ pendientes: _p, ...t }) => t);
  }

  async vistaPanel(clubId: string, torneoId: string) {
    return this.vista(await this.torneo(clubId, torneoId), true);
  }

  async vistaPublica(clubSlug: string, torneoSlug: string) {
    const club = await this.clubPorSlug(clubSlug);
    const [t] = await this.e.db
      .select()
      .from(torneos)
      .where(and(eq(torneos.clubId, club.id), eq(torneos.slug, torneoSlug.toLowerCase())));
    if (!t) throw new ErrorNegocio(404, 'TORNEO_NO_ENCONTRADO', 'No existe ese torneo');
    return this.vista(t, false);
  }

  /**
   * Todo lo que muestra el torneo: equipos, tabla de cada grupo, fixture y cuadro. En la
   * vista pública no van los datos del delegado ni los equipos sin aprobar.
   */
  private async vista(t: Torneo, privado: boolean) {
    const [equipos, partidos, listaCanchas] = await Promise.all([
      this.e.db
        .select()
        .from(torneoEquipos)
        .where(eq(torneoEquipos.torneoId, t.id))
        .orderBy(asc(torneoEquipos.creadoEn)),
      this.e.db
        .select()
        .from(torneoPartidos)
        .where(eq(torneoPartidos.torneoId, t.id))
        .orderBy(
          sql`${torneoPartidos.fase} DESC`,
          sql`${torneoPartidos.fecha} NULLS LAST`,
          sql`${torneoPartidos.ronda} DESC NULLS LAST`,
          asc(torneoPartidos.orden),
          asc(torneoPartidos.inicio),
        ),
      this.e.db
        .select({ id: canchas.id, nombre: canchas.nombre })
        .from(canchas)
        .where(eq(canchas.clubId, t.clubId)),
    ]);
    const nombre = new Map(equipos.map((e) => [e.id, e.nombre]));
    const cancha = new Map(listaCanchas.map((c) => [c.id, c.nombre]));
    const equipo = (id: string | null) => (id ? { id, nombre: nombre.get(id) ?? '' } : null);
    const aprobados = equipos.filter((e) => e.estado === 'APROBADO');

    const grupos = this.tablas(t, aprobados, partidos).map((tabla, i) => ({
      numero: i + 1,
      tabla: tabla.map((f) => ({ ...f, nombre: nombre.get(f.equipo) ?? '' })),
    }));
    const deGrupos = partidos.filter((p) => p.fase === 'GRUPOS');
    const hayEliminacion = partidos.some((p) => p.fase === 'ELIMINACION');

    return {
      torneo: {
        id: t.id,
        nombre: t.nombre,
        slug: t.slug,
        descripcion: t.descripcion,
        estado: t.estado,
        jugadoresPorLado: t.jugadoresPorLado,
        inscripcionOnline: t.inscripcionOnline,
        cantidadGrupos: t.cantidadGrupos,
        idaYVuelta: t.idaYVuelta,
        clasificanPorGrupo: t.clasificanPorGrupo,
        dias: t.dias,
        horaDesde: t.horaDesde?.slice(0, 5) ?? null,
        horaHasta: t.horaHasta?.slice(0, 5) ?? null,
        canchaIds: t.canchaIds,
        fechaInicio: t.fechaInicio,
        duracionMin: t.duracionMin,
      },
      equipos: (privado ? equipos : aprobados).map((e) => ({
        id: e.id,
        nombre: e.nombre,
        estado: e.estado,
        grupo: e.grupo,
        ...(privado
          ? {
              delegadoNombre: e.delegadoNombre,
              delegadoTelefono: e.delegadoTelefono,
              delegadoEmail: e.delegadoEmail,
            }
          : {}),
      })),
      grupos: t.estado === 'INSCRIPCION' ? [] : grupos,
      partidos: partidos.map((p) => ({
        id: p.id,
        fase: p.fase,
        grupo: p.grupo,
        fecha: p.fecha,
        ronda: p.ronda,
        orden: p.orden,
        local: equipo(p.localId),
        visitante: equipo(p.visitanteId),
        canchaId: p.canchaId,
        cancha: p.canchaId ? (cancha.get(p.canchaId) ?? null) : null,
        inicio: p.inicio?.toISOString() ?? null,
        fin: p.fin?.toISOString() ?? null,
        golesLocal: p.golesLocal,
        golesVisitante: p.golesVisitante,
        penalesLocal: p.penalesLocal,
        penalesVisitante: p.penalesVisitante,
        ganadorId: p.ganadorId,
        estado: p.estado,
      })),
      /** Terminó la fase de grupos y falta armar el cuadro. */
      eliminacionPendiente:
        t.estado === 'EN_CURSO' &&
        t.clasificanPorGrupo > 0 &&
        !hayEliminacion &&
        deGrupos.length > 0 &&
        deGrupos.every((p) => p.estado === 'JUGADO'),
    };
  }

  private tablas(t: Torneo, aprobados: { id: string; grupo: number | null }[], partidos: Partido[]) {
    return Array.from({ length: t.cantidadGrupos }, (_, g) => {
      const delGrupo = aprobados.filter((e) => e.grupo === g + 1).map((e) => e.id);
      const jugados = partidos
        .filter((p) => p.fase === 'GRUPOS' && p.grupo === g + 1 && p.estado === 'JUGADO')
        .map((p) => ({
          local: p.localId as string,
          visitante: p.visitanteId as string,
          golesLocal: p.golesLocal ?? 0,
          golesVisitante: p.golesVisitante ?? 0,
        }));
      return tablaDePosiciones(delGrupo, jugados, { victoria: t.puntosVictoria, empate: t.puntosEmpate });
    });
  }

  // --- Alta y configuración ----------------------------------------------------

  async crear(clubId: string, d: DatosTorneo) {
    await this.validarDatos(clubId, d);
    const base = slugDesde(d.nombre) || 'torneo';
    for (let n = 1; n < 50; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      try {
        const [t] = await this.e.db
          .insert(torneos)
          .values({ clubId, slug, ...this.columnas(d) })
          .returning({ id: torneos.id, slug: torneos.slug });
        if (t) return t;
      } catch (err) {
        if (!violaUnique(err)) throw err;
      }
    }
    throw new ErrorNegocio(409, 'NOMBRE_EN_USO', 'Ya hay demasiados torneos con ese nombre');
  }

  async actualizar(clubId: string, torneoId: string, d: DatosTorneo) {
    const t = await this.torneo(clubId, torneoId);
    if (t.estado !== 'INSCRIPCION') {
      throw new ErrorNegocio(409, 'TORNEO_EMPEZADO', 'El torneo ya empezó: el formato no se puede cambiar');
    }
    await this.validarDatos(clubId, d);
    await this.e.db.update(torneos).set(this.columnas(d)).where(eq(torneos.id, t.id));
  }

  async eliminar(clubId: string, torneoId: string) {
    const t = await this.torneo(clubId, torneoId);
    if (t.estado !== 'INSCRIPCION') {
      throw new ErrorNegocio(409, 'TORNEO_EMPEZADO', 'Un torneo que ya empezó no se puede borrar');
    }
    await this.e.db.delete(torneos).where(eq(torneos.id, t.id));
  }

  private columnas(d: DatosTorneo) {
    return {
      nombre: d.nombre.trim(),
      descripcion: d.descripcion?.trim() || null,
      jugadoresPorLado: d.jugadoresPorLado,
      inscripcionOnline: d.inscripcionOnline,
      cantidadGrupos: d.cantidadGrupos,
      idaYVuelta: d.idaYVuelta,
      clasificanPorGrupo: d.clasificanPorGrupo,
      dias: [...new Set(d.dias)].sort(),
      horaDesde: d.horaDesde,
      horaHasta: d.horaHasta,
      canchaIds: [...new Set(d.canchaIds)],
      fechaInicio: d.fechaInicio,
      duracionMin: d.duracionMin,
    };
  }

  private async validarDatos(clubId: string, d: DatosTorneo) {
    if (d.dias.length === 0)
      throw new ErrorNegocio(422, 'SIN_DIAS', 'Elegí al menos un día para los partidos');
    if (d.canchaIds.length === 0) throw new ErrorNegocio(422, 'SIN_CANCHAS', 'Elegí al menos una cancha');
    const delClub = await this.e.db
      .select({ id: canchas.id })
      .from(canchas)
      .where(and(eq(canchas.clubId, clubId), inArray(canchas.id, d.canchaIds)));
    if (delClub.length !== new Set(d.canchaIds).size) {
      throw new ErrorNegocio(422, 'CANCHA_INVALIDA', 'Alguna de las canchas no es del club');
    }
    const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
    const franja = (minutos(d.horaHasta) - minutos(d.horaDesde) + 1440) % 1440 || 1440;
    if (franja < d.duracionMin) {
      throw new ErrorNegocio(422, 'FRANJA_CORTA', 'En la franja horaria no entra ni un partido');
    }
  }

  // --- Equipos -------------------------------------------------------------------

  async agregarEquipo(clubId: string, torneoId: string, d: DatosEquipo) {
    const t = await this.torneo(clubId, torneoId);
    return this.insertarEquipo(t, d, 'APROBADO');
  }

  /** Inscripción desde la página del torneo: queda pendiente hasta que el club la aprueba. */
  async inscribirOnline(clubSlug: string, torneoSlug: string, d: DatosEquipo) {
    const club = await this.clubPorSlug(clubSlug);
    const [t] = await this.e.db
      .select()
      .from(torneos)
      .where(and(eq(torneos.clubId, club.id), eq(torneos.slug, torneoSlug.toLowerCase())));
    if (!t) throw new ErrorNegocio(404, 'TORNEO_NO_ENCONTRADO', 'No existe ese torneo');
    if (!t.inscripcionOnline || t.estado !== 'INSCRIPCION') {
      throw new ErrorNegocio(409, 'INSCRIPCION_CERRADA', 'La inscripción online de este torneo está cerrada');
    }
    return this.insertarEquipo(t, d, 'PENDIENTE');
  }

  private async insertarEquipo(t: Torneo, d: DatosEquipo, estado: 'PENDIENTE' | 'APROBADO') {
    if (t.estado !== 'INSCRIPCION') {
      throw new ErrorNegocio(409, 'TORNEO_EMPEZADO', 'El torneo ya empezó: no se pueden sumar equipos');
    }
    const telefono = telefonoValido(d.delegadoTelefono);
    try {
      const [e] = await this.e.db
        .insert(torneoEquipos)
        .values({
          torneoId: t.id,
          nombre: d.nombre.trim(),
          delegadoNombre: d.delegadoNombre.trim(),
          delegadoTelefono: telefono,
          delegadoEmail: d.delegadoEmail?.trim().toLowerCase() || null,
          estado,
        })
        .returning({ id: torneoEquipos.id, estado: torneoEquipos.estado });
      if (!e) throw new Error('insert de equipo sin filas');
      return e;
    } catch (err) {
      if (violaUnique(err)) {
        throw new ErrorNegocio(409, 'EQUIPO_REPETIDO', 'Ya hay un equipo con ese nombre en el torneo');
      }
      throw err;
    }
  }

  async cambiarEstadoEquipo(
    clubId: string,
    torneoId: string,
    equipoId: string,
    estado: 'APROBADO' | 'RECHAZADO',
  ) {
    const t = await this.torneo(clubId, torneoId);
    if (t.estado !== 'INSCRIPCION') throw new ErrorNegocio(409, 'TORNEO_EMPEZADO', 'El torneo ya empezó');
    const r = await this.e.db
      .update(torneoEquipos)
      .set({ estado })
      .where(and(eq(torneoEquipos.id, equipoId), eq(torneoEquipos.torneoId, t.id)))
      .returning({ id: torneoEquipos.id });
    if (r.length === 0) throw new ErrorNegocio(404, 'EQUIPO_NO_ENCONTRADO', 'No existe ese equipo');
  }

  async quitarEquipo(clubId: string, torneoId: string, equipoId: string) {
    const t = await this.torneo(clubId, torneoId);
    if (t.estado !== 'INSCRIPCION') throw new ErrorNegocio(409, 'TORNEO_EMPEZADO', 'El torneo ya empezó');
    const r = await this.e.db
      .delete(torneoEquipos)
      .where(and(eq(torneoEquipos.id, equipoId), eq(torneoEquipos.torneoId, t.id)))
      .returning({ id: torneoEquipos.id });
    if (r.length === 0) throw new ErrorNegocio(404, 'EQUIPO_NO_ENCONTRADO', 'No existe ese equipo');
  }

  // --- Empezar: sorteo de grupos y fixture con horarios ---------------------------

  /**
   * Sortea los grupos, arma el fixture de cada uno y agenda cada partido en un hueco
   * libre (bloqueando la cancha en la agenda). Cada fecha se juega en un día distinto.
   */
  async iniciar(clubId: string, torneoId: string, usuarioId: string, { sortear = true } = {}) {
    const t = await this.torneo(clubId, torneoId);
    if (t.estado !== 'INSCRIPCION') throw new ErrorNegocio(409, 'TORNEO_EMPEZADO', 'El torneo ya empezó');
    const aprobados = await this.e.db
      .select({ id: torneoEquipos.id, nombre: torneoEquipos.nombre })
      .from(torneoEquipos)
      .where(and(eq(torneoEquipos.torneoId, t.id), eq(torneoEquipos.estado, 'APROBADO')))
      .orderBy(asc(torneoEquipos.creadoEn));
    if (aprobados.length < t.cantidadGrupos * 2) {
      throw new ErrorNegocio(
        422,
        'POCOS_EQUIPOS',
        `Hacen falta al menos ${t.cantidadGrupos * 2} equipos aprobados (2 por grupo)`,
      );
    }
    const orden = sortear ? mezclar(aprobados) : aprobados;
    const grupos = repartirEnGrupos(orden, t.cantidadGrupos);
    const nombre = new Map(aprobados.map((e) => [e.id, e.nombre]));

    // Fecha k de todos los grupos juntas: una "jornada" por día.
    const cruces = grupos.map((g, i) =>
      todosContraTodos(
        g.map((e) => e.id),
        t.idaYVuelta,
      ).map((c) => ({ ...c, grupo: i + 1 })),
    );
    const jornadas = Math.max(...cruces.map((c) => Math.max(0, ...c.map((x) => x.fecha))));
    const porJornada = Array.from({ length: jornadas }, (_, f) =>
      cruces.flat().filter((c) => c.fecha === f + 1),
    );

    const zona = await this.zonaDe(clubId);
    await this.agendando(async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      for (const [i, g] of grupos.entries()) {
        await tx
          .update(torneoEquipos)
          .set({ grupo: i + 1 })
          .where(
            inArray(
              torneoEquipos.id,
              g.map((e) => e.id),
            ),
          );
      }
      const huecos = await this.repartirHuecos(
        tx,
        t,
        zona,
        porJornada.map((j) => j.length),
        t.fechaInicio as string,
      );
      for (const [j, jornada] of porJornada.entries()) {
        for (const [k, c] of jornada.entries()) {
          const h = huecos[j]?.[k] as Hueco;
          const turnoId = await this.bloquear(
            tx,
            t,
            h,
            usuarioId,
            `${nombre.get(c.local)} vs ${nombre.get(c.visitante)}`,
          );
          await tx.insert(torneoPartidos).values({
            torneoId: t.id,
            fase: 'GRUPOS',
            grupo: c.grupo,
            fecha: c.fecha,
            localId: c.local,
            visitanteId: c.visitante,
            canchaId: h.canchaId,
            inicio: h.inicio,
            fin: h.fin,
            turnoId,
          });
        }
      }
      await tx.update(torneos).set({ estado: 'EN_CURSO' }).where(eq(torneos.id, t.id));
      await this.avisarFixture(tx, t);
    });
  }

  /**
   * Con la fase de grupos terminada: arma el cuadro con los clasificados (cruzando
   * grupos) y agenda cada ronda en un día distinto, después del último partido jugado.
   * Las rondas siguientes quedan agendadas sin equipos: se completan con los ganadores.
   */
  async armarEliminacion(clubId: string, torneoId: string, usuarioId: string) {
    const t = await this.torneo(clubId, torneoId);
    const v = await this.vista(t, true);
    if (!v.eliminacionPendiente) {
      throw new ErrorNegocio(
        409,
        'ELIMINACION_NO_DISPONIBLE',
        t.clasificanPorGrupo === 0
          ? 'Este torneo no tiene eliminación'
          : 'Primero tienen que estar cargados todos los resultados de la fase de grupos',
      );
    }
    const partidos = await this.e.db.select().from(torneoPartidos).where(eq(torneoPartidos.torneoId, t.id));
    const aprobados = await this.e.db
      .select({ id: torneoEquipos.id, nombre: torneoEquipos.nombre, grupo: torneoEquipos.grupo })
      .from(torneoEquipos)
      .where(and(eq(torneoEquipos.torneoId, t.id), eq(torneoEquipos.estado, 'APROBADO')));
    const nombre = new Map(aprobados.map((e) => [e.id, e.nombre]));
    const pasan = clasificados(this.tablas(t, aprobados, partidos), t.clasificanPorGrupo);
    const primera = primeraRonda(pasan.map((c) => ({ equipo: c.equipo, grupo: c.grupo })));
    if (primera.length === 0)
      throw new ErrorNegocio(422, 'POCOS_CLASIFICADOS', 'No hay suficientes clasificados');

    // Todas las rondas, de la primera a la final.
    const rondas: { ronda: number; cruces: { local: string | null; visitante: string | null }[] }[] = [];
    for (let r = primera[0]?.ronda ?? 1; r >= 1; r = Math.floor(r / 2)) {
      rondas.push({
        ronda: r,
        cruces:
          r === primera[0]?.ronda
            ? primera.map((c) => ({ local: c.local, visitante: c.visitante }))
            : Array.from({ length: r }, () => ({ local: null, visitante: null })),
      });
      if (r === 1) break;
    }
    // Los que pasan directo (bye) no juegan: se agenda solo lo que se juega.
    const seJuega = (ronda: number, c: { local: string | null; visitante: string | null }) =>
      ronda !== primera[0]?.ronda || (c.local !== null && c.visitante !== null);

    const zona = await this.zonaDe(clubId);
    const ultimo = partidos.reduce<Date | null>(
      (m, p) => (p.inicio && (!m || p.inicio > m) ? p.inicio : m),
      null,
    );
    const desde = ultimo ? sumarDias(partesLocales(ultimo, zona).fecha, 1) : (t.fechaInicio as string);

    await this.agendando(async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      const huecos = await this.repartirHuecos(
        tx,
        t,
        zona,
        rondas.map((r) => r.cruces.filter((c) => seJuega(r.ronda, c)).length),
        desde,
      );
      const byes: { ronda: number; orden: number; ganador: string }[] = [];
      for (const [i, r] of rondas.entries()) {
        let k = 0;
        for (const [orden, c] of r.cruces.entries()) {
          if (!seJuega(r.ronda, c)) {
            const ganador = (c.local ?? c.visitante) as string;
            await tx.insert(torneoPartidos).values({
              torneoId: t.id,
              fase: 'ELIMINACION',
              ronda: r.ronda,
              orden,
              localId: ganador,
              ganadorId: ganador,
              estado: 'JUGADO',
            });
            byes.push({ ronda: r.ronda, orden, ganador });
            continue;
          }
          const h = huecos[i]?.[k++] as Hueco;
          const etiqueta =
            c.local && c.visitante
              ? `${nombre.get(c.local)} vs ${nombre.get(c.visitante)}`
              : `Eliminación (${r.ronda})`;
          const turnoId = await this.bloquear(tx, t, h, usuarioId, etiqueta);
          await tx.insert(torneoPartidos).values({
            torneoId: t.id,
            fase: 'ELIMINACION',
            ronda: r.ronda,
            orden,
            localId: c.local,
            visitanteId: c.visitante,
            canchaId: h.canchaId,
            inicio: h.inicio,
            fin: h.fin,
            turnoId,
          });
        }
      }
      for (const b of byes) await this.avanzar(tx, t.id, b.ronda, b.orden, b.ganador);
    });
  }

  // --- Resultados --------------------------------------------------------------------

  async cargarResultado(clubId: string, torneoId: string, partidoId: string, r: ResultadoCarga) {
    const t = await this.torneo(clubId, torneoId);
    if (t.estado === 'INSCRIPCION') throw new ErrorNegocio(409, 'TORNEO_NO_EMPEZO', 'El torneo no empezó');
    return this.e.db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(torneoPartidos)
        .where(and(eq(torneoPartidos.id, partidoId), eq(torneoPartidos.torneoId, t.id)))
        .for('update');
      if (!p) throw new ErrorNegocio(404, 'PARTIDO_NO_ENCONTRADO', 'No existe ese partido');
      if (!p.localId || !p.visitanteId) {
        throw new ErrorNegocio(409, 'PARTIDO_SIN_EQUIPOS', 'Todavía no se sabe quiénes juegan este partido');
      }
      let ganador: string | null = null;
      let penalesLocal: number | null = null;
      let penalesVisitante: number | null = null;
      if (r.golesLocal !== r.golesVisitante) {
        ganador = r.golesLocal > r.golesVisitante ? p.localId : p.visitanteId;
      } else if (p.fase === 'ELIMINACION') {
        if (r.penalesLocal == null || r.penalesVisitante == null || r.penalesLocal === r.penalesVisitante) {
          throw new ErrorNegocio(422, 'FALTAN_PENALES', 'En la eliminación, un empate se define por penales');
        }
        penalesLocal = r.penalesLocal;
        penalesVisitante = r.penalesVisitante;
        ganador = r.penalesLocal > r.penalesVisitante ? p.localId : p.visitanteId;
      }
      if (p.fase === 'ELIMINACION' && p.ganadorId && p.ganadorId !== ganador && p.ronda && p.ronda > 1) {
        const [sig] = await tx
          .select({ estado: torneoPartidos.estado })
          .from(torneoPartidos)
          .where(
            and(
              eq(torneoPartidos.torneoId, t.id),
              eq(torneoPartidos.fase, 'ELIMINACION'),
              eq(torneoPartidos.ronda, Math.floor(p.ronda / 2)),
              eq(torneoPartidos.orden, Math.floor((p.orden ?? 0) / 2)),
            ),
          );
        if (sig?.estado === 'JUGADO') {
          throw new ErrorNegocio(
            409,
            'SIGUIENTE_JUGADO',
            'El partido siguiente ya se jugó: no se puede cambiar el ganador',
          );
        }
      }
      await tx
        .update(torneoPartidos)
        .set({
          golesLocal: r.golesLocal,
          golesVisitante: r.golesVisitante,
          penalesLocal,
          penalesVisitante,
          ganadorId: ganador,
          estado: 'JUGADO',
        })
        .where(eq(torneoPartidos.id, p.id));
      if (p.fase === 'ELIMINACION' && ganador) {
        if (p.ronda === 1) {
          await tx.update(torneos).set({ estado: 'FINALIZADO' }).where(eq(torneos.id, t.id));
        } else await this.avanzar(tx, t.id, p.ronda as number, p.orden as number, ganador);
      }
      if (p.fase === 'GRUPOS' && t.clasificanPorGrupo === 0) {
        const [faltan] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(torneoPartidos)
          .where(and(eq(torneoPartidos.torneoId, t.id), ne(torneoPartidos.estado, 'JUGADO')));
        if ((faltan?.n ?? 0) === 0) {
          await tx.update(torneos).set({ estado: 'FINALIZADO' }).where(eq(torneos.id, t.id));
        }
      }
    });
  }

  /** El ganador de (ronda, orden) ocupa su lugar en el partido siguiente. */
  private async avanzar(tx: Tx, torneoId: string, ronda: number, orden: number, ganador: string) {
    if (ronda <= 1) return;
    await tx
      .update(torneoPartidos)
      .set(orden % 2 === 0 ? { localId: ganador } : { visitanteId: ganador })
      .where(
        and(
          eq(torneoPartidos.torneoId, torneoId),
          eq(torneoPartidos.fase, 'ELIMINACION'),
          eq(torneoPartidos.ronda, Math.floor(ronda / 2)),
          eq(torneoPartidos.orden, Math.floor(orden / 2)),
        ),
      );
  }

  /** Cambia cancha y horario de un partido: libera el bloqueo anterior y toma el nuevo. */
  async moverPartido(
    clubId: string,
    torneoId: string,
    partidoId: string,
    p: { inicio: Date; canchaId: string },
    usuarioId: string,
  ) {
    const t = await this.torneo(clubId, torneoId);
    const [c] = await this.e.db
      .select({ id: canchas.id })
      .from(canchas)
      .where(and(eq(canchas.id, p.canchaId), eq(canchas.clubId, clubId)));
    if (!c) throw new ErrorNegocio(422, 'CANCHA_INVALIDA', 'Esa cancha no es del club');
    await this.agendando(async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      const [partido] = await tx
        .select()
        .from(torneoPartidos)
        .where(and(eq(torneoPartidos.id, partidoId), eq(torneoPartidos.torneoId, t.id)))
        .for('update');
      if (!partido) throw new ErrorNegocio(404, 'PARTIDO_NO_ENCONTRADO', 'No existe ese partido');
      if (partido.estado === 'JUGADO')
        throw new ErrorNegocio(409, 'PARTIDO_JUGADO', 'Ese partido ya se jugó');
      if (partido.turnoId) {
        await tx
          .update(turnos)
          .set({
            estado: 'CANCELADO',
            canceladoEn: this.e.reloj(),
            motivoCancelacion: 'Partido reprogramado',
          })
          .where(eq(turnos.id, partido.turnoId));
      }
      const fin = new Date(p.inicio.getTime() + t.duracionMin * 60_000);
      const nombres = await tx
        .select({ id: torneoEquipos.id, nombre: torneoEquipos.nombre })
        .from(torneoEquipos)
        .where(eq(torneoEquipos.torneoId, t.id));
      const nombre = new Map(nombres.map((e) => [e.id, e.nombre]));
      const etiqueta =
        partido.localId && partido.visitanteId
          ? `${nombre.get(partido.localId)} vs ${nombre.get(partido.visitanteId)}`
          : 'Partido del torneo';
      const turnoId = await this.bloquear(
        tx,
        t,
        { canchaId: p.canchaId, inicio: p.inicio, fin, fecha: '' },
        usuarioId,
        etiqueta,
      );
      await tx
        .update(torneoPartidos)
        .set({ canchaId: p.canchaId, inicio: p.inicio, fin, turnoId, recordatorioEn: null })
        .where(eq(torneoPartidos.id, partido.id));
      await this.avisarMovido(tx, t, partido.id);
    });
  }

  async finalizar(clubId: string, torneoId: string) {
    const t = await this.torneo(clubId, torneoId);
    if (t.estado !== 'EN_CURSO')
      throw new ErrorNegocio(409, 'TORNEO_NO_EN_CURSO', 'El torneo no está en curso');
    await this.e.db.update(torneos).set({ estado: 'FINALIZADO' }).where(eq(torneos.id, t.id));
  }

  // --- Agenda ---------------------------------------------------------------------------

  private async bloquear(tx: Tx, t: Torneo, h: Hueco, usuarioId: string, etiqueta: string) {
    const turno = await insertarTurno(
      tx,
      {
        clubId: t.clubId,
        canchaId: h.canchaId,
        clienteId: null,
        inicio: h.inicio,
        fin: h.fin,
        estado: 'CONFIRMADO',
        origen: 'BLOQUEO',
        precioTotal: 0,
        montoSena: 0,
        expiraEn: null,
        creadoPor: usuarioId,
        nota: `${t.nombre}: ${etiqueta}`,
      },
      this.e.reloj(),
      this.e.urlWeb,
    );
    return turno.id;
  }

  /**
   * Huecos para cada tanda (`cantidades[i]` partidos), cada tanda en días posteriores a
   * la anterior. Se usan los días, la franja y las canchas del torneo, salteando lo que ya
   * está ocupado en la agenda y lo que ya pasó.
   */
  private async repartirHuecos(tx: Tx, t: Torneo, zona: string, cantidades: number[], desde: string) {
    const ahora = this.e.reloj();
    const limite = sumarDias(desde, HORIZONTE_DIAS);
    const ocupados = await tx
      .select({ canchaId: turnos.canchaId, inicio: turnos.inicio, fin: turnos.fin })
      .from(turnos)
      .where(
        and(
          inArray(turnos.canchaId, t.canchaIds),
          inArray(turnos.estado, [...ESTADOS_QUE_OCUPAN]),
          or(ne(turnos.estado, 'PRE_RESERVADO'), isNull(turnos.expiraEn), gt(turnos.expiraEn, ahora)),
          gt(turnos.fin, instanteLocal(desde, '00:00', zona)),
          lt(turnos.inicio, instanteLocal(sumarDias(limite, 1), '00:00', zona)),
        ),
      );
    const libre = (h: Hueco) =>
      h.inicio > ahora &&
      !ocupados.some((o) => o.canchaId === h.canchaId && o.inicio < h.fin && o.fin > h.inicio);

    const huecosDelDia = (fecha: string): Hueco[] => {
      if (!t.dias.includes(diaSemana(fecha))) return [];
      const desdeMin = minutosDe(t.horaDesde as string);
      let hastaMin = minutosDe(t.horaHasta as string);
      if (hastaMin <= desdeMin) hastaMin += 1440;
      const lista: Hueco[] = [];
      for (let m = desdeMin; m + t.duracionMin <= hastaMin; m += t.duracionMin) {
        for (const canchaId of t.canchaIds) {
          const dia = m >= 1440 ? sumarDias(fecha, 1) : fecha;
          const inicio = instanteLocal(dia, horaDe(m % 1440), zona);
          lista.push({ canchaId, inicio, fin: new Date(inicio.getTime() + t.duracionMin * 60_000), fecha });
        }
      }
      return lista;
    };

    const resultado: Hueco[][] = [];
    let fecha = desde;
    for (const cantidad of cantidades) {
      const tanda: Hueco[] = [];
      let ultimaFecha = fecha;
      while (tanda.length < cantidad) {
        if (fecha > limite) {
          throw new ErrorNegocio(
            422,
            'SIN_LUGAR',
            'No entran todos los partidos en el próximo año: sumá días, canchas u horas al torneo',
          );
        }
        for (const h of huecosDelDia(fecha)) {
          if (tanda.length >= cantidad) break;
          if (!libre(h)) continue;
          tanda.push(h);
          ocupados.push({ canchaId: h.canchaId, inicio: h.inicio, fin: h.fin });
          ultimaFecha = fecha;
        }
        if (tanda.length < cantidad) fecha = sumarDias(fecha, 1);
      }
      resultado.push(tanda);
      fecha = sumarDias(ultimaFecha, 1);
    }
    return resultado;
  }

  // --- Auxiliares ---------------------------------------------------------------------

  /** Transacción que toma horarios de la agenda: si alguno se ocupó en el medio, 409. */
  private async agendando(fn: (tx: Tx) => Promise<void>) {
    try {
      await this.e.db.transaction(fn);
    } catch (err) {
      if (!esTurnoOcupado(err)) throw err;
      throw new ErrorNegocio(409, 'HORARIO_OCUPADO', 'Ese horario ya está ocupado en la agenda');
    }
  }

  private async torneo(clubId: string, torneoId: string) {
    const [t] = await this.e.db
      .select()
      .from(torneos)
      .where(and(eq(torneos.id, torneoId), eq(torneos.clubId, clubId)));
    if (!t) throw new ErrorNegocio(404, 'TORNEO_NO_ENCONTRADO', 'No existe ese torneo');
    return t;
  }

  private async clubPorSlug(slug: string) {
    const [c] = await this.e.db
      .select({ id: clubs.id })
      .from(clubs)
      .where(and(eq(clubs.slug, slug.toLowerCase()), eq(clubs.activo, true)));
    if (!c) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe un club con ese link');
    return c;
  }

  // --- Avisos a los delegados (por mail, si dejaron uno) --------------------------------

  /** Club, link público del torneo y equipos con su email, para armar los avisos. */
  private async datosAviso(tx: Tx, t: Torneo) {
    const [club] = await tx
      .select({ nombre: clubs.nombre, slug: clubs.slug, zona: clubs.zonaHoraria })
      .from(clubs)
      .where(eq(clubs.id, t.clubId));
    const equipos = await tx
      .select({ id: torneoEquipos.id, nombre: torneoEquipos.nombre, email: torneoEquipos.delegadoEmail })
      .from(torneoEquipos)
      .where(eq(torneoEquipos.torneoId, t.id));
    const listaCanchas = await tx
      .select({ id: canchas.id, nombre: canchas.nombre })
      .from(canchas)
      .where(eq(canchas.clubId, t.clubId));
    const zona = club?.zona ?? 'America/Argentina/Buenos_Aires';
    const cancha = new Map(listaCanchas.map((c) => [c.id, c.nombre]));
    return {
      club: club?.nombre ?? '',
      link: `${this.e.urlWeb.replace(/\/$/, '')}/${club?.slug}/torneos/${t.slug}`,
      equipo: new Map(equipos.map((e) => [e.id, e])),
      cuando: (p: { inicio: Date | null; canchaId: string | null }) =>
        p.inicio
          ? `${fechaCorta(p.inicio, zona)} ${horaCorta(p.inicio, zona)}${p.canchaId ? ` en la ${cancha.get(p.canchaId) ?? 'cancha'}` : ''}`
          : 'a confirmar',
    };
  }

  private async avisar(
    tx: Tx,
    t: Torneo,
    email: string | null | undefined,
    plantilla: Plantilla,
    p: Record<string, string>,
  ) {
    await encolarNotificacion(tx, {
      clubId: t.clubId,
      clienteId: null,
      telefono: null,
      email: email ?? null,
      plantilla,
      parametros: p,
    });
  }

  /** Al sortear: a cada delegado, el primer partido de su equipo y el link al fixture. */
  private async avisarFixture(tx: Tx, t: Torneo) {
    const d = await this.datosAviso(tx, t);
    const partidos = await tx
      .select()
      .from(torneoPartidos)
      .where(eq(torneoPartidos.torneoId, t.id))
      .orderBy(asc(torneoPartidos.inicio));
    for (const e of d.equipo.values()) {
      if (!e.email) continue;
      const p = partidos.find((x) => x.localId === e.id || x.visitanteId === e.id);
      const rival = p
        ? d.equipo.get((p.localId === e.id ? p.visitanteId : p.localId) ?? '')?.nombre
        : undefined;
      await this.avisar(tx, t, e.email, 'torneo_fixture', {
        club: d.club,
        torneo: t.nombre,
        equipo: e.nombre,
        primero: p ? `${d.cuando(p)} contra ${rival ?? 'a definir'}` : 'a confirmar',
        link: d.link,
      });
    }
  }

  /** El club movió un partido: les avisa a los dos equipos. */
  private async avisarMovido(tx: Tx, t: Torneo, partidoId: string) {
    const [p] = await tx.select().from(torneoPartidos).where(eq(torneoPartidos.id, partidoId));
    if (!p?.localId || !p.visitanteId) return;
    const d = await this.datosAviso(tx, t);
    const local = d.equipo.get(p.localId);
    const visitante = d.equipo.get(p.visitanteId);
    for (const e of [local, visitante]) {
      await this.avisar(tx, t, e?.email, 'torneo_partido_movido', {
        club: d.club,
        torneo: t.nombre,
        partido: `${local?.nombre} vs ${visitante?.nombre}`,
        cuando: d.cuando(p),
        link: d.link,
      });
    }
  }

  /**
   * Para el worker: los partidos de las próximas 24 horas que todavía no se recordaron
   * (con los dos equipos definidos). Cada partido se procesa una sola vez.
   */
  async recordarPartidos(): Promise<{ partidos: number }> {
    const ahora = this.e.reloj();
    const hasta = new Date(ahora.getTime() + 24 * 60 * 60_000);
    return this.e.db.transaction(async (tx) => {
      const elegidos = await tx
        .select({ id: torneoPartidos.id })
        .from(torneoPartidos)
        .where(
          and(
            eq(torneoPartidos.estado, 'PROGRAMADO'),
            isNull(torneoPartidos.recordatorioEn),
            gt(torneoPartidos.inicio, ahora),
            lt(torneoPartidos.inicio, hasta),
            sql`${torneoPartidos.localId} IS NOT NULL AND ${torneoPartidos.visitanteId} IS NOT NULL`,
          ),
        )
        .limit(200)
        .for('update', { skipLocked: true });
      if (elegidos.length === 0) return { partidos: 0 };
      const partidos = await tx
        .update(torneoPartidos)
        .set({ recordatorioEn: ahora })
        .where(
          inArray(
            torneoPartidos.id,
            elegidos.map((e) => e.id),
          ),
        )
        .returning();
      const porTorneo = new Map<string, typeof partidos>();
      for (const p of partidos) porTorneo.set(p.torneoId, [...(porTorneo.get(p.torneoId) ?? []), p]);
      for (const [torneoId, lista] of porTorneo) {
        const [t] = await tx.select().from(torneos).where(eq(torneos.id, torneoId));
        if (!t) continue;
        const d = await this.datosAviso(tx, t);
        for (const p of lista) {
          const local = d.equipo.get(p.localId ?? '');
          const visitante = d.equipo.get(p.visitanteId ?? '');
          for (const [e, rival] of [
            [local, visitante],
            [visitante, local],
          ] as const) {
            await this.avisar(tx, t, e?.email, 'torneo_proximo_partido', {
              club: d.club,
              torneo: t.nombre,
              equipo: e?.nombre ?? '',
              rival: rival?.nombre ?? '',
              cuando: d.cuando(p),
              link: d.link,
            });
          }
        }
      }
      return { partidos: partidos.length };
    });
  }

  private async zonaDe(clubId: string) {
    const cfg = await this.e.clubs.porId(clubId);
    return cfg?.club.zonaHoraria ?? 'America/Argentina/Buenos_Aires';
  }
}

const minutosDe = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const horaDe = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Fisher-Yates con números aleatorios del sistema. */
function mezclar<T>(lista: T[]): T[] {
  const r = [...lista];
  for (let i = r.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [r[i], r[j]] = [r[j] as T, r[i] as T];
  }
  return r;
}

export type VistaTorneo = Awaited<ReturnType<ServicioTorneos['vistaPanel']>>;
export type { FilaTabla };
