import { instanteLocal, sumarDias, ventanasDeJornada } from '@cancheria/core';
import type { Db } from '@cancheria/db';
import {
  canchas,
  clientes,
  notificaciones,
  pagos,
  reembolsos,
  turnos,
  turnosEventos,
} from '@cancheria/db/schema';
import {
  aCuenta,
  type ConfigClub,
  consumosDeTurnoSql,
  descuentosDeTurnoSql,
  ErrorNegocio,
  PLANTILLAS,
  type Plantilla,
  pagadoDeTurnoSql,
  type Reloj,
  saldoDe,
} from '@cancheria/servicios';
import { and, asc, desc, eq, notInArray, type SQL, sql } from 'drizzle-orm';

const senaEnRevisionSql = sql<boolean>`EXISTS (
  SELECT 1 FROM pagos p WHERE p.turno_id = ${turnos.id} AND p.estado = 'EN_REVISION')`;

/** Lecturas del panel (sin efectos). */
export class ConsultasAdmin {
  constructor(
    private readonly db: Db,
    private readonly reloj: Reloj,
  ) {}

  /**
   * Agenda de una jornada: todas las canchas y todos los turnos que tocan ese día
   * local (incluida la madrugada del día siguiente si el club cierra tarde, y turnos
   * manuales fuera del horario de apertura).
   */
  async agenda(cfg: ConfigClub, fecha: string, { incluirCancelados = false } = {}) {
    const zona = cfg.club.zonaHoraria;
    const ventanas = ventanasDeJornada(
      fecha,
      zona,
      cfg.horarios,
      cfg.especiales.find((e) => e.fecha === fecha),
    );
    const diaDesde = instanteLocal(fecha, '00:00', zona);
    const diaHasta = instanteLocal(sumarDias(fecha, 1), '00:00', zona);
    const desde = new Date(Math.min(diaDesde.getTime(), ...ventanas.map((v) => v.inicio.getTime())));
    const hasta = new Date(Math.max(diaHasta.getTime(), ...ventanas.map((v) => v.fin.getTime())));
    const ahora = this.reloj();

    const filas = await this.db
      .select({
        id: turnos.id,
        canchaId: turnos.canchaId,
        inicio: turnos.inicio,
        fin: turnos.fin,
        estado: turnos.estado,
        origen: turnos.origen,
        precioTotal: turnos.precioTotal,
        montoSena: turnos.montoSena,
        expiraEn: turnos.expiraEn,
        checkinEn: turnos.checkinEn,
        nota: turnos.nota,
        motivoCancelacion: turnos.motivoCancelacion,
        cliente: { id: clientes.id, nombre: clientes.nombre, telefono: clientes.telefonoE164 },
        pagado: pagadoDeTurnoSql,
        consumos: consumosDeTurnoSql,
        descuentos: descuentosDeTurnoSql,
        senaEnRevision: senaEnRevisionSql,
      })
      .from(turnos)
      .leftJoin(clientes, eq(clientes.id, turnos.clienteId))
      .where(
        and(
          eq(turnos.clubId, cfg.club.id),
          sql`${turnos.rango} && tstzrange(${desde.toISOString()}::timestamptz, ${hasta.toISOString()}::timestamptz, '[)')`,
          notInArray(turnos.estado, incluirCancelados ? ['EXPIRADO'] : ['EXPIRADO', 'CANCELADO']),
        ),
      )
      .orderBy(asc(turnos.inicio));

    const lista = filas
      .map((f) => {
        // Un hold vencido que el worker todavía no barrió ya no ocupa la cancha.
        const vencido = f.estado === 'PRE_RESERVADO' && f.expiraEn !== null && f.expiraEn <= ahora;
        const cuenta = aCuenta(f);
        return {
          ...f,
          estado: vencido ? ('EXPIRADO' as const) : f.estado,
          inicio: f.inicio.toISOString(),
          fin: f.fin.toISOString(),
          expiraEn: f.expiraEn?.toISOString() ?? null,
          checkinEn: f.checkinEn?.toISOString() ?? null,
          cliente: f.cliente?.id ? f.cliente : null,
          ...cuenta,
          saldo: saldoDe(cuenta),
        };
      })
      .filter((t) => t.estado !== 'EXPIRADO');

    return {
      fecha,
      zonaHoraria: zona,
      apertura: ventanas.map((v) => ({ inicio: v.inicio.toISOString(), fin: v.fin.toISOString() })),
      canchas: cfg.canchas.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        jugadoresPorLado: c.jugadoresPorLado,
        duracionMin: c.duracionTurnoMin,
      })),
      turnos: lista,
    };
  }

  /** Detalle de un turno con sus pagos y el historial de estados (auditoría). */
  async turno(clubId: string, turnoId: string) {
    const [t] = await this.db
      .select({
        id: turnos.id,
        canchaId: turnos.canchaId,
        cancha: canchas.nombre,
        inicio: turnos.inicio,
        fin: turnos.fin,
        estado: turnos.estado,
        origen: turnos.origen,
        precioTotal: turnos.precioTotal,
        montoSena: turnos.montoSena,
        expiraEn: turnos.expiraEn,
        codigo: turnos.codigoCheckin,
        nota: turnos.nota,
        motivoCancelacion: turnos.motivoCancelacion,
        checkinEn: turnos.checkinEn,
        cliente: {
          id: clientes.id,
          nombre: clientes.nombre,
          telefono: clientes.telefonoE164,
          dni: clientes.dni,
          bloqueado: clientes.bloqueado,
        },
        pagado: pagadoDeTurnoSql,
        consumos: consumosDeTurnoSql,
        descuentos: descuentosDeTurnoSql,
      })
      .from(turnos)
      .innerJoin(canchas, eq(canchas.id, turnos.canchaId))
      .leftJoin(clientes, eq(clientes.id, turnos.clienteId))
      .where(and(eq(turnos.id, turnoId), eq(turnos.clubId, clubId)));
    if (!t) throw new ErrorNegocio(404, 'TURNO_NO_ENCONTRADO', 'No existe ese turno');

    const [listaPagos, historial] = await Promise.all([
      this.db
        .select({
          id: pagos.id,
          proveedor: pagos.proveedor,
          concepto: pagos.concepto,
          estado: pagos.estado,
          monto: pagos.monto,
          creadoEn: pagos.creadoEn,
          tieneComprobante: sql<boolean>`${pagos.comprobanteUrl} IS NOT NULL`,
          reembolso: { id: reembolsos.id, estado: reembolsos.estado, motivo: reembolsos.motivo },
        })
        .from(pagos)
        .leftJoin(reembolsos, eq(reembolsos.pagoId, pagos.id))
        .where(eq(pagos.turnoId, turnoId))
        .orderBy(asc(pagos.creadoEn)),
      this.db
        .select({
          de: turnosEventos.deEstado,
          a: turnosEventos.aEstado,
          actor: turnosEventos.actor,
          en: turnosEventos.creadoEn,
        })
        .from(turnosEventos)
        .where(eq(turnosEventos.turnoId, turnoId))
        .orderBy(asc(turnosEventos.id)),
    ]);
    const cuenta = aCuenta(t);
    return {
      ...t,
      ...cuenta,
      cliente: t.cliente?.id ? t.cliente : null,
      saldo: saldoDe(cuenta),
      pagos: listaPagos.map((p) => ({ ...p, reembolso: p.reembolso?.id ? p.reembolso : null })),
      historial,
    };
  }

  async transferencias(clubId: string, estado: 'EN_REVISION' | 'APROBADO' | 'RECHAZADO') {
    return this.db
      .select({
        pagoId: pagos.id,
        monto: pagos.monto,
        estado: pagos.estado,
        enviadaEn: pagos.creadoEn,
        turno: {
          id: turnos.id,
          inicio: turnos.inicio,
          estado: turnos.estado,
          expiraEn: turnos.expiraEn,
          montoSena: turnos.montoSena,
        },
        cancha: canchas.nombre,
        cliente: { nombre: clientes.nombre, telefono: clientes.telefonoE164 },
      })
      .from(pagos)
      .innerJoin(turnos, eq(turnos.id, pagos.turnoId))
      .innerJoin(canchas, eq(canchas.id, turnos.canchaId))
      .leftJoin(clientes, eq(clientes.id, turnos.clienteId))
      .where(and(eq(pagos.clubId, clubId), eq(pagos.proveedor, 'TRANSFERENCIA'), eq(pagos.estado, estado)))
      .orderBy(estado === 'EN_REVISION' ? asc(pagos.creadoEn) : desc(pagos.creadoEn))
      .limit(200);
  }

  async comprobante(clubId: string, pagoId: string) {
    const [p] = await this.db
      .select({ clave: pagos.comprobanteUrl })
      .from(pagos)
      .where(and(eq(pagos.id, pagoId), eq(pagos.clubId, clubId)));
    if (!p?.clave) throw new ErrorNegocio(404, 'COMPROBANTE_NO_ENCONTRADO', 'Ese pago no tiene comprobante');
    return p.clave;
  }

  async reembolsos(clubId: string, estado?: 'PENDIENTE' | 'HECHO' | 'FALLIDO') {
    const condiciones: SQL[] = [eq(reembolsos.clubId, clubId)];
    if (estado) condiciones.push(eq(reembolsos.estado, estado));
    const filas = await this.db
      .select({
        id: reembolsos.id,
        monto: reembolsos.monto,
        motivo: reembolsos.motivo,
        estado: reembolsos.estado,
        intentos: reembolsos.intentos,
        error: reembolsos.error,
        creadoEn: reembolsos.creadoEn,
        hechoEn: reembolsos.hechoEn,
        medio: pagos.proveedor,
        turnoId: pagos.turnoId,
        cliente: { nombre: clientes.nombre, telefono: clientes.telefonoE164 },
      })
      .from(reembolsos)
      .innerJoin(pagos, eq(pagos.id, reembolsos.pagoId))
      .innerJoin(turnos, eq(turnos.id, pagos.turnoId))
      .leftJoin(clientes, eq(clientes.id, turnos.clienteId))
      .where(and(...condiciones))
      .orderBy(desc(reembolsos.creadoEn))
      .limit(200);
    // Los de MP pendientes los ejecuta el worker; el resto se devuelve a mano.
    return filas.map((r) => ({ ...r, manual: r.medio !== 'MERCADO_PAGO' || r.estado === 'FALLIDO' }));
  }

  /** Últimos mensajes al cliente (outbox), con el texto como lo recibe. */
  async mensajes(clubId: string, estado?: 'PENDIENTE' | 'ENVIADA' | 'FALLIDA') {
    const filas = await this.db
      .select({
        id: notificaciones.id,
        plantilla: notificaciones.plantilla,
        destino: notificaciones.destino,
        payload: notificaciones.payload,
        estado: notificaciones.estado,
        intentos: notificaciones.intentos,
        error: notificaciones.error,
        creadoEn: notificaciones.creadoEn,
        enviadaEn: notificaciones.enviadaEn,
        cliente: clientes.nombre,
      })
      .from(notificaciones)
      .leftJoin(clientes, eq(clientes.id, notificaciones.clienteId))
      .where(and(eq(notificaciones.clubId, clubId), estado ? eq(notificaciones.estado, estado) : undefined))
      .orderBy(desc(notificaciones.creadoEn))
      .limit(100);
    return filas.map(({ payload, ...m }) => {
      const p = PLANTILLAS[m.plantilla as Plantilla];
      return { ...m, texto: p ? p.texto(payload as Record<string, string>) : JSON.stringify(payload) };
    });
  }

  /** Vuelve a encolar un mensaje que falló (por ejemplo, después de aprobar la plantilla). */
  async reintentarMensaje(clubId: string, id: string) {
    const filas = await this.db
      .update(notificaciones)
      .set({ estado: 'PENDIENTE', intentos: 0, proximoIntento: this.reloj(), error: null })
      .where(
        and(
          eq(notificaciones.id, id),
          eq(notificaciones.clubId, clubId),
          eq(notificaciones.estado, 'FALLIDA'),
        ),
      )
      .returning({ id: notificaciones.id });
    if (filas.length === 0)
      throw new ErrorNegocio(404, 'MENSAJE_NO_ENCONTRADO', 'No hay un mensaje fallido con ese id');
  }
}
