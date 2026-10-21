import {
  diaSemana,
  instanteLocal,
  partesLocales,
  sumarDias,
  sumarMinutos,
  ventanasDeJornada,
} from '@cancheria/core';
import { esTurnoOcupado, type Tx, violaUnique } from '@cancheria/db';
import { canchas, clientes, pagos, turnos, turnosFijos, turnosFijosOmitidos } from '@cancheria/db/schema';
import { and, asc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { type DatosCliente, telefonoValido, upsertCliente } from './clientes.ts';
import type { ConfigClub, RepoClubs } from './config-club.ts';
import { cotizarTurno } from './cotizacion.ts';
import type { Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';
import { fechaCorta } from './formato.ts';
import type { ServicioListaEspera } from './lista-espera.ts';
import { encolarNotificacion } from './notificaciones/encolar.ts';
import { insertarTurno, setActor } from './turnos.ts';

/** Hasta cuántas semanas adelante se generan los turnos de cada fijo. */
export const HORIZONTE_SEMANAS = 8;
const MAX_DURACION_MIN = 6 * 60;
const DIAS = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
const VIVOS = ['PRE_RESERVADO', 'CONFIRMADO', 'PRESENTE', 'AUSENTE'] as const;

export type MotivoOmision = 'OCUPADO' | 'CERRADO' | 'SIN_TARIFA';

export interface DatosTurnoFijo {
  canchaId: string;
  cliente: DatosCliente;
  diaSemana: number;
  /** HH:MM, hora del club. */
  horaInicio: string;
  /** Por defecto, la duración de turno de la cancha. */
  duracionMin?: number | undefined;
  frecuenciaSemanas: 1 | 2 | 4;
  /** Primera fecha posible; se corre al primer día que coincide con `diaSemana`. */
  vigenteDesde: string;
  vigenteHasta?: string | null | undefined;
  /** Centavos por turno; null = la tarifa vigente de cada fecha. */
  precioPactado?: number | null | undefined;
  nota?: string | null | undefined;
  notificar?: boolean | undefined;
}

/** Lo que define las fechas y el precio (la vista previa no necesita al cliente). */
export type PlantillaFijo = Omit<DatosTurnoFijo, 'cliente' | 'nota' | 'notificar'>;

export interface Ocurrencia {
  fecha: string;
  inicio: Date;
  fin: Date;
  estado: 'LIBRE' | MotivoOmision;
  precio: number | null;
  /** Con quién choca, si está ocupado. */
  conflicto: { turnoId: string; cliente: string | null; origen: string } | null;
}

const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Primera fecha ≥ `desde` que cae en `dia` (0 = domingo). */
export function primeraFecha(desde: string, dia: number) {
  return sumarDias(desde, (dia - diaSemana(desde) + 7) % 7);
}

/**
 * Fechas de un fijo entre `desde` y `hasta` (inclusive). La cadencia se ancla en
 * `vigenteDesde` (que siempre es una fecha del fijo): cada 1, 2 o 4 semanas desde ahí.
 */
export function fechasDelFijo(
  f: { vigenteDesde: string; vigenteHasta: string | null; frecuenciaSemanas: number },
  desde: string,
  hasta: string,
): string[] {
  const paso = 7 * f.frecuenciaSemanas;
  const fin = f.vigenteHasta && f.vigenteHasta < hasta ? f.vigenteHasta : hasta;
  const saltos = Math.max(0, Math.ceil(diasEntre(f.vigenteDesde, desde) / paso));
  const fechas: string[] = [];
  for (let d = sumarDias(f.vigenteDesde, saltos * paso); d <= fin; d = sumarDias(d, paso)) fechas.push(d);
  return fechas;
}

/** El turno entra entero en el horario de apertura (de ese día o de la madrugada del anterior). */
function abierto(cfg: ConfigClub, fecha: string, inicio: Date, fin: Date) {
  const ventanas = [sumarDias(fecha, -1), fecha].flatMap((d) =>
    ventanasDeJornada(
      d,
      cfg.club.zonaHoraria,
      cfg.horarios,
      cfg.especiales.find((e) => e.fecha === d),
    ),
  );
  return ventanas.some((v) => v.inicio <= inicio && fin <= v.fin);
}

type FilaFijo = typeof turnosFijos.$inferSelect;

/**
 * Turnos fijos: el mismo cliente, la misma cancha y horario cada 1, 2 o 4 semanas.
 * Se guardan como plantilla y se materializan como turnos CONFIRMADO/FIJO hasta
 * HORIZONTE_SEMANAS adelante (al crearlos y después el worker, cada hora). Una fecha
 * que choca con otro turno nunca lo pisa: queda registrada como omitida para que el
 * club la resuelva.
 */
export class ServicioTurnosFijos {
  constructor(private readonly e: Entorno & { clubs: RepoClubs; listaEspera: ServicioListaEspera }) {}

  private hoy(cfg: ConfigClub) {
    return partesLocales(this.e.reloj(), cfg.club.zonaHoraria).fecha;
  }

  private async cfg(clubId: string) {
    const cfg = await this.e.clubs.porId(clubId);
    if (!cfg) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
    return cfg;
  }

  /** Normaliza y valida el pedido; no toca la base. */
  private plantilla(cfg: ConfigClub, p: PlantillaFijo) {
    const cancha = cfg.canchas.find((c) => c.id === p.canchaId);
    if (!cancha) throw new ErrorNegocio(404, 'CANCHA_NO_ENCONTRADA', 'La cancha no existe o está inactiva');
    const duracionMin = p.duracionMin ?? cancha.duracionTurnoMin;
    if (duracionMin <= 0 || duracionMin > MAX_DURACION_MIN) {
      throw new ErrorNegocio(422, 'DURACION_INVALIDA', 'La duración tiene que ser de hasta 6 horas');
    }
    const hoy = this.hoy(cfg);
    const vigenteDesde = primeraFecha(p.vigenteDesde < hoy ? hoy : p.vigenteDesde, p.diaSemana);
    const vigenteHasta = p.vigenteHasta ?? null;
    if (vigenteHasta !== null && vigenteHasta < vigenteDesde) {
      throw new ErrorNegocio(
        422,
        'VIGENCIA_INVALIDA',
        'La fecha de fin es anterior a la primera fecha del turno fijo',
      );
    }
    return {
      cancha,
      canchaId: cancha.id,
      diaSemana: p.diaSemana,
      horaInicio: p.horaInicio,
      duracionMin,
      frecuenciaSemanas: p.frecuenciaSemanas,
      vigenteDesde,
      vigenteHasta,
      precioPactado: p.precioPactado ?? null,
    };
  }

  /** Cómo quedaría cada fecha del horizonte: libre, ocupada (y por quién), club cerrado o sin precio. */
  private async ocurrencias(
    tx: Tx | Entorno['db'],
    cfg: ConfigClub,
    f: Pick<
      FilaFijo,
      | 'canchaId'
      | 'horaInicio'
      | 'duracionMin'
      | 'frecuenciaSemanas'
      | 'vigenteDesde'
      | 'vigenteHasta'
      | 'precioPactado'
    > & { id?: string },
    desde: string,
    hasta: string,
  ): Promise<Ocurrencia[]> {
    const ahora = this.e.reloj();
    const cancha = cfg.canchas.find((c) => c.id === f.canchaId);
    const fechas = fechasDelFijo(f, desde, hasta);
    const r: Ocurrencia[] = [];
    for (const fecha of fechas) {
      const inicio = instanteLocal(fecha, f.horaInicio.slice(0, 5), cfg.club.zonaHoraria);
      const fin = sumarMinutos(inicio, f.duracionMin);
      if (inicio <= ahora) continue;
      const precio = f.precioPactado ?? (cancha ? (cotizarTurno(cfg, cancha, inicio)?.precio ?? null) : null);
      let estado: Ocurrencia['estado'] = 'LIBRE';
      let conflicto: Ocurrencia['conflicto'] = null;
      if (!cancha || !abierto(cfg, fecha, inicio, fin)) estado = 'CERRADO';
      else if (precio === null) estado = 'SIN_TARIFA';
      else {
        const [o] = await tx
          .select({ turnoId: turnos.id, cliente: clientes.nombre, origen: turnos.origen })
          .from(turnos)
          .leftJoin(clientes, eq(clientes.id, turnos.clienteId))
          .where(
            and(
              eq(turnos.canchaId, f.canchaId),
              inArray(turnos.estado, [...VIVOS]),
              or(ne(turnos.estado, 'PRE_RESERVADO'), gt(turnos.expiraEn, ahora)),
              f.id ? or(isNull(turnos.turnoFijoId), ne(turnos.turnoFijoId, f.id)) : undefined,
              sql`${turnos.rango} && tstzrange(${inicio.toISOString()}::timestamptz, ${fin.toISOString()}::timestamptz, '[)')`,
            ),
          )
          .limit(1);
        if (o) {
          estado = 'OCUPADO';
          conflicto = o;
        }
      }
      r.push({ fecha, inicio, fin, estado, precio, conflicto });
    }
    return r;
  }

  /** Vista previa antes de crear: qué fechas del horizonte quedarían y cuáles chocan. */
  async previsualizar(clubId: string, p: PlantillaFijo) {
    const cfg = await this.cfg(clubId);
    const f = this.plantilla(cfg, p);
    const hasta = sumarDias(this.hoy(cfg), HORIZONTE_SEMANAS * 7);
    return {
      vigenteDesde: f.vigenteDesde,
      duracionMin: f.duracionMin,
      ocurrencias: await this.ocurrencias(this.e.db, cfg, f, f.vigenteDesde, hasta),
    };
  }

  async crear(clubId: string, usuarioId: string, p: DatosTurnoFijo) {
    const cfg = await this.cfg(clubId);
    const f = this.plantilla(cfg, p);
    const fijo = await this.e.db.transaction(async (tx) => {
      const cliente = await upsertCliente(tx, clubId, p.cliente);
      const [fila] = await tx
        .insert(turnosFijos)
        .values({
          clubId,
          canchaId: f.canchaId,
          clienteId: cliente.id,
          diaSemana: f.diaSemana,
          horaInicio: f.horaInicio,
          duracionMin: f.duracionMin,
          frecuenciaSemanas: f.frecuenciaSemanas,
          vigenteDesde: f.vigenteDesde,
          vigenteHasta: f.vigenteHasta,
          precioPactado: f.precioPactado,
          nota: p.nota ?? null,
          creadoPor: usuarioId,
        })
        .returning();
      if (!fila) throw new Error('insert de turno fijo sin filas');
      if (p.notificar !== false) {
        await encolarNotificacion(tx, {
          clubId,
          clienteId: cliente.id,
          destino: telefonoValido(p.cliente.telefono),
          plantilla: 'turno_fijo_creado',
          parametros: {
            club: cfg.club.nombre,
            cancha: f.cancha.nombre,
            dia: DIAS[f.diaSemana] ?? '',
            hora: f.horaInicio,
            desde: fechaCorta(
              instanteLocal(f.vigenteDesde, '12:00', cfg.club.zonaHoraria),
              cfg.club.zonaHoraria,
            ),
          },
        });
      }
      return fila;
    });
    const resultado = await this.materializar(fijo.id, `usuario:${usuarioId}`);
    return { id: fijo.id, ...resultado };
  }

  /**
   * Genera los turnos que falten hasta el horizonte. Idempotente y seguro con el worker
   * corriendo a la vez: toma el fijo con FOR UPDATE (el worker con SKIP LOCKED) y cada
   * fecha va en un savepoint, así un choque no tira abajo las demás.
   */
  async materializar(fijoId: string, actor = 'worker:turnos-fijos', { saltarBloqueados = false } = {}) {
    return this.e.db.transaction(async (tx) => {
      const consulta = tx.select().from(turnosFijos).where(eq(turnosFijos.id, fijoId));
      const [f] = saltarBloqueados
        ? await consulta.for('update', { skipLocked: true })
        : await consulta.for('update');
      const vacio = { creados: 0, omitidos: [] as { fecha: string; motivo: MotivoOmision }[] };
      if (!f?.activo) return vacio;
      const cfg = await this.cfg(f.clubId);
      const hoy = this.hoy(cfg);
      const siguiente = f.materializadoHasta ? sumarDias(f.materializadoHasta, 1) : '';
      const desde = [f.vigenteDesde, hoy, siguiente].reduce((a, b) => (a > b ? a : b));
      let hasta = sumarDias(hoy, HORIZONTE_SEMANAS * 7);
      if (f.vigenteHasta && f.vigenteHasta < hasta) hasta = f.vigenteHasta;
      if (desde > hasta) return vacio;

      await setActor(tx, actor);
      const r = await this.generar(tx, f, await this.ocurrencias(tx, cfg, f, desde, hasta));
      await tx.update(turnosFijos).set({ materializadoHasta: hasta }).where(eq(turnosFijos.id, f.id));
      return r;
    });
  }

  private async generar(tx: Tx, f: FilaFijo, ocurrencias: Ocurrencia[]) {
    let creados = 0;
    const omitidos: { fecha: string; motivo: MotivoOmision }[] = [];
    const omitir = async (o: Ocurrencia, motivo: MotivoOmision, turnoConflictoId: string | null) => {
      omitidos.push({ fecha: o.fecha, motivo });
      await tx
        .insert(turnosFijosOmitidos)
        .values({ turnoFijoId: f.id, fecha: o.fecha, clubId: f.clubId, motivo, turnoConflictoId })
        .onConflictDoUpdate({
          target: [turnosFijosOmitidos.turnoFijoId, turnosFijosOmitidos.fecha],
          set: { motivo, turnoConflictoId, revisadoEn: null },
        });
    };
    for (const o of ocurrencias) {
      if (o.estado !== 'LIBRE' && o.estado !== 'OCUPADO') {
        await omitir(o, o.estado, null);
        continue;
      }
      try {
        await tx.transaction(async (sp) => {
          await insertarTurno(
            sp,
            {
              clubId: f.clubId,
              canchaId: f.canchaId,
              clienteId: f.clienteId,
              inicio: o.inicio,
              fin: o.fin,
              estado: 'CONFIRMADO',
              origen: 'FIJO',
              precioTotal: o.precio ?? 0,
              montoSena: 0,
              expiraEn: null,
              creadoPor: f.creadoPor ?? undefined,
              turnoFijoId: f.id,
            },
            this.e.reloj(),
            this.e.urlWeb,
          );
        });
        creados++;
        await tx
          .delete(turnosFijosOmitidos)
          .where(and(eq(turnosFijosOmitidos.turnoFijoId, f.id), eq(turnosFijosOmitidos.fecha, o.fecha)));
      } catch (err) {
        // Ya estaba generada (otro proceso, o se canceló esa semana): no se toca.
        if (violaUnique(err, 'turnos_fijo_inicio_uq')) continue;
        if (!esTurnoOcupado(err)) throw err;
        await omitir(o, 'OCUPADO', o.conflicto?.turnoId ?? (await this.ocupante(tx, f, o))?.turnoId ?? null);
      }
    }
    return { creados, omitidos };
  }

  private async ocupante(tx: Tx, f: FilaFijo, o: Ocurrencia) {
    const [x] = await tx
      .select({ turnoId: turnos.id })
      .from(turnos)
      .where(
        and(
          eq(turnos.canchaId, f.canchaId),
          inArray(turnos.estado, [...VIVOS]),
          sql`${turnos.rango} && tstzrange(${o.inicio.toISOString()}::timestamptz, ${o.fin.toISOString()}::timestamptz, '[)')`,
        ),
      )
      .limit(1);
    return x;
  }

  /** Lo que corre el worker: materializa todos los fijos activos que tengan fechas por generar. */
  async materializarPendientes() {
    // Fecha en UTC con un día de margen para cualquier zona horaria; cada fijo después
    // se calcula con la fecha de su club.
    const hoy = partesLocales(this.e.reloj(), 'UTC').fecha;
    const fijos = await this.e.db
      .select({ id: turnosFijos.id })
      .from(turnosFijos)
      .where(
        and(
          eq(turnosFijos.activo, true),
          or(isNull(turnosFijos.vigenteHasta), gte(turnosFijos.vigenteHasta, sumarDias(hoy, -1))),
          or(
            isNull(turnosFijos.materializadoHasta),
            lte(turnosFijos.materializadoHasta, sumarDias(hoy, HORIZONTE_SEMANAS * 7)),
          ),
        ),
      );
    let creados = 0;
    let omitidos = 0;
    for (const { id } of fijos) {
      const r = await this.materializar(id, 'worker:turnos-fijos', { saltarBloqueados: true });
      creados += r.creados;
      omitidos += r.omitidos.length;
    }
    return { fijos: fijos.length, creados, omitidos };
  }

  // --- Panel --------------------------------------------------------------------

  async listar(clubId: string) {
    const cfg = await this.cfg(clubId);
    const ahora = this.e.reloj();
    const hoy = this.hoy(cfg);
    const filas = await this.e.db
      .select({
        f: turnosFijos,
        cancha: canchas.nombre,
        cliente: { id: clientes.id, nombre: clientes.nombre, telefono: clientes.telefonoE164 },
        proximo: sql<Date | null>`(
          SELECT min(t.inicio) FROM turnos t
          WHERE t.turno_fijo_id = ${turnosFijos.id} AND t.estado = 'CONFIRMADO' AND t.inicio > ${ahora.toISOString()}::timestamptz
        )`.mapWith((v: string | null) => (v ? new Date(v) : null)),
      })
      .from(turnosFijos)
      .innerJoin(canchas, eq(canchas.id, turnosFijos.canchaId))
      .innerJoin(clientes, eq(clientes.id, turnosFijos.clienteId))
      .where(eq(turnosFijos.clubId, clubId))
      .orderBy(asc(turnosFijos.diaSemana), asc(turnosFijos.horaInicio), asc(canchas.orden));
    const omitidos = await this.e.db
      .select({
        turnoFijoId: turnosFijosOmitidos.turnoFijoId,
        fecha: turnosFijosOmitidos.fecha,
        motivo: turnosFijosOmitidos.motivo,
        conflicto: clientes.nombre,
        conflictoOrigen: turnos.origen,
      })
      .from(turnosFijosOmitidos)
      .leftJoin(turnos, eq(turnos.id, turnosFijosOmitidos.turnoConflictoId))
      .leftJoin(clientes, eq(clientes.id, turnos.clienteId))
      .where(
        and(
          eq(turnosFijosOmitidos.clubId, clubId),
          isNull(turnosFijosOmitidos.revisadoEn),
          gte(turnosFijosOmitidos.fecha, hoy),
        ),
      )
      .orderBy(asc(turnosFijosOmitidos.fecha));

    return filas.map(({ f, cancha, cliente, proximo }) => ({
      id: f.id,
      canchaId: f.canchaId,
      cancha,
      cliente,
      diaSemana: f.diaSemana,
      horaInicio: f.horaInicio.slice(0, 5),
      duracionMin: f.duracionMin,
      frecuenciaSemanas: f.frecuenciaSemanas,
      vigenteDesde: f.vigenteDesde,
      vigenteHasta: f.vigenteHasta,
      precioPactado: f.precioPactado,
      nota: f.nota,
      activo: f.activo && (f.vigenteHasta === null || f.vigenteHasta >= hoy),
      proximo: proximo?.toISOString() ?? null,
      omitidos: omitidos
        .filter((o) => o.turnoFijoId === f.id)
        .map(({ turnoFijoId: _f, conflictoOrigen, conflicto, ...o }) => ({
          ...o,
          conflicto: conflictoOrigen === 'BLOQUEO' ? 'Bloqueo' : conflicto,
        })),
    }));
  }

  private async fijoDelClub(tx: Tx, clubId: string, fijoId: string) {
    const [f] = await tx
      .select()
      .from(turnosFijos)
      .where(and(eq(turnosFijos.id, fijoId), eq(turnosFijos.clubId, clubId)))
      .for('update');
    if (!f) throw new ErrorNegocio(404, 'TURNO_FIJO_NO_ENCONTRADO', 'No existe ese turno fijo');
    return f;
  }

  /**
   * Cambia el precio pactado (o lo vuelve a la tarifa) y la nota. El precio nuevo se
   * aplica también a los turnos ya generados que todavía no tienen pagos.
   */
  async modificar(
    clubId: string,
    usuarioId: string,
    fijoId: string,
    p: { precioPactado?: number | null | undefined; nota?: string | null | undefined },
  ) {
    const cfg = await this.cfg(clubId);
    return this.e.db.transaction(async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      const f = await this.fijoDelClub(tx, clubId, fijoId);
      await tx
        .update(turnosFijos)
        .set({
          ...(p.precioPactado !== undefined ? { precioPactado: p.precioPactado } : {}),
          ...(p.nota !== undefined ? { nota: p.nota } : {}),
        })
        .where(eq(turnosFijos.id, fijoId));
      if (p.precioPactado === undefined) return { actualizados: 0 };

      const cancha = cfg.canchas.find((c) => c.id === f.canchaId);
      const futuros = await this.futurosSinPagos(tx, fijoId, this.e.reloj());
      let actualizados = 0;
      for (const t of futuros) {
        const precio = p.precioPactado ?? (cancha ? cotizarTurno(cfg, cancha, t.inicio)?.precio : undefined);
        if (precio === undefined) continue;
        await tx.update(turnos).set({ precioTotal: precio }).where(eq(turnos.id, t.id));
        actualizados++;
      }
      return { actualizados };
    });
  }

  /** Turnos generados de un fijo, CONFIRMADO, desde `desde`, sin ningún pago aprobado. */
  private async futurosSinPagos(tx: Tx, fijoId: string, desde: Date) {
    return tx
      .select({
        id: turnos.id,
        inicio: turnos.inicio,
        fin: turnos.fin,
        canchaId: turnos.canchaId,
        clienteId: turnos.clienteId,
      })
      .from(turnos)
      .where(
        and(
          eq(turnos.turnoFijoId, fijoId),
          eq(turnos.estado, 'CONFIRMADO'),
          gte(turnos.inicio, desde),
          sql`NOT EXISTS (SELECT 1 FROM ${pagos} p WHERE p.turno_id = ${turnos.id} AND p.estado = 'APROBADO')`,
        ),
      )
      .orderBy(asc(turnos.inicio));
  }

  /**
   * Termina el turno fijo: la última fecha es la anterior a `desde`. Los turnos ya
   * generados desde esa fecha se cancelan (y se ofrecen a la lista de espera), salvo
   * los que tienen pagos: esos quedan para que el club decida desde la agenda.
   */
  async darDeBaja(
    clubId: string,
    usuarioId: string,
    fijoId: string,
    p: { desde: string; motivo?: string | undefined },
  ) {
    const cfg = await this.cfg(clubId);
    const hoy = this.hoy(cfg);
    const desde = p.desde < hoy ? hoy : p.desde;
    return this.e.db.transaction(async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      const f = await this.fijoDelClub(tx, clubId, fijoId);
      const ultima = sumarDias(desde, -1);
      await tx
        .update(turnosFijos)
        .set({
          vigenteHasta: f.vigenteHasta && f.vigenteHasta < ultima ? f.vigenteHasta : ultima,
          activo: ultima >= f.vigenteDesde,
        })
        .where(eq(turnosFijos.id, fijoId));

      const inicioBaja = instanteLocal(desde, '00:00', cfg.club.zonaHoraria);
      const ahora = this.e.reloj();
      const aCancelar = await this.futurosSinPagos(tx, fijoId, inicioBaja > ahora ? inicioBaja : ahora);
      const motivo = p.motivo?.trim() || 'Baja del turno fijo';
      for (const t of aCancelar) {
        await tx
          .update(turnos)
          .set({ estado: 'CANCELADO', canceladoEn: ahora, motivoCancelacion: motivo })
          .where(eq(turnos.id, t.id));
        await this.e.listaEspera.ofrecer(tx, { ...t, clubId });
      }
      const [conPagos] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(turnos)
        .where(
          and(
            eq(turnos.turnoFijoId, fijoId),
            eq(turnos.estado, 'CONFIRMADO'),
            gte(turnos.inicio, inicioBaja),
          ),
        );
      await tx
        .delete(turnosFijosOmitidos)
        .where(and(eq(turnosFijosOmitidos.turnoFijoId, fijoId), gte(turnosFijosOmitidos.fecha, desde)));
      return { cancelados: aCancelar.length, conPagos: conPagos?.n ?? 0 };
    });
  }

  /** Vuelve a intentar una fecha omitida (por ejemplo, después de mover el turno que chocaba). */
  async reintentar(clubId: string, usuarioId: string, fijoId: string, fecha: string) {
    const cfg = await this.cfg(clubId);
    return this.e.db.transaction(async (tx) => {
      const f = await this.fijoDelClub(tx, clubId, fijoId);
      const [omitido] = await tx
        .select()
        .from(turnosFijosOmitidos)
        .where(and(eq(turnosFijosOmitidos.turnoFijoId, fijoId), eq(turnosFijosOmitidos.fecha, fecha)));
      if (!omitido) throw new ErrorNegocio(404, 'OMITIDO_NO_ENCONTRADO', 'Esa fecha no está pendiente');
      await setActor(tx, `usuario:${usuarioId}`);
      const ocurrencias = await this.ocurrencias(tx, cfg, f, fecha, fecha);
      if (ocurrencias.length === 0) {
        throw new ErrorNegocio(409, 'FECHA_PASADA', 'Esa fecha ya pasó');
      }
      const r = await this.generar(tx, f, ocurrencias);
      return { creado: r.creados === 1, motivo: r.omitidos[0]?.motivo ?? null };
    });
  }

  /** El club ya resolvió la fecha por su cuenta (le avisó al cliente, etc.). */
  async descartarOmitido(clubId: string, fijoId: string, fecha: string) {
    const filas = await this.e.db
      .update(turnosFijosOmitidos)
      .set({ revisadoEn: this.e.reloj() })
      .where(
        and(
          eq(turnosFijosOmitidos.turnoFijoId, fijoId),
          eq(turnosFijosOmitidos.clubId, clubId),
          eq(turnosFijosOmitidos.fecha, fecha),
        ),
      )
      .returning({ fecha: turnosFijosOmitidos.fecha });
    if (filas.length === 0)
      throw new ErrorNegocio(404, 'OMITIDO_NO_ENCONTRADO', 'Esa fecha no está pendiente');
  }

  /** Cantidad de fechas omitidas sin revisar (para el aviso en el menú del panel). */
  async pendientes(clubId: string) {
    const cfg = await this.cfg(clubId);
    const [r] = await this.e.db
      .select({ n: sql<number>`count(*)::int` })
      .from(turnosFijosOmitidos)
      .where(
        and(
          eq(turnosFijosOmitidos.clubId, clubId),
          isNull(turnosFijosOmitidos.revisadoEn),
          gte(turnosFijosOmitidos.fecha, this.hoy(cfg)),
        ),
      );
    return r?.n ?? 0;
  }
}
