import { esTurnoOcupado, type Tx } from '@cancheria/db';
import { canchas, clientes, pagos, reembolsos, turnos } from '@cancheria/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type DatosCliente, upsertCliente } from './clientes.ts';
import type { RepoClubs } from './config-club.ts';
import { cotizarTurno } from './cotizacion.ts';
import type { Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';
import { pesos } from './formato.ts';
import type { ServicioListaEspera } from './lista-espera.ts';
import {
  bloquearTurno,
  cerrarCheckoutsAbiertos,
  confirmarSena,
  insertarTurno,
  notificarTurno,
  setActor,
} from './turnos.ts';

const MAX_DURACION_MIN = 6 * 60;
/** El check-in se acepta desde 1 h antes del inicio hasta el final del turno. */
const CHECKIN_ANTICIPACION_MIN = 60;
/** Se puede cargar un turno que ya empezó (alguien que llegó sin reservar). */
const CARGA_RETROACTIVA_MIN = 3 * 60;

export interface ResumenCobro {
  turnoId: string;
  estado: string;
  inicio: string;
  fin: string;
  cancha: string;
  cliente: { nombre: string; telefono: string } | null;
  precioTotal: number;
  /** Pagos aprobados (seña + saldo) menos lo reembolsado. */
  pagado: number;
  saldo: number;
}

/** Extrae el código del contenido del QR: la URL del comprobante (`…/r/<codigo>`) o el código solo. */
export function codigoDesdeQr(qr: string): string | null {
  const m = qr.trim().match(/(?:^|\/r\/)([0-9a-f]{32})(?:[/?#]|$)/i);
  return m?.[1]?.toLowerCase() ?? null;
}

/** Operación diaria del club desde el panel. `usuarioId` queda en la auditoría de cada cambio. */
export class ServicioOperacion {
  constructor(private readonly e: Entorno & { clubs: RepoClubs; listaEspera: ServicioListaEspera }) {}

  /** Turno cargado por el club (teléfono, mostrador). Se confirma directo, sin seña. */
  async crearManual(
    clubId: string,
    usuarioId: string,
    p: {
      canchaId: string;
      inicio: Date;
      fin?: Date | undefined;
      cliente: DatosCliente;
      /** centavos; si falta se usa la tarifa del horario. */
      precio?: number | undefined;
      nota?: string | undefined;
      notificar?: boolean | undefined;
      idempotencyKey?: string | undefined;
    },
  ) {
    const { cancha, fin } = await this.validarRango(clubId, p.canchaId, p.inicio, p.fin);
    let precio = p.precio;
    if (precio === undefined) {
      const cfg = await this.e.clubs.porId(clubId);
      precio = cfg ? cotizarTurno(cfg, cancha, p.inicio)?.precio : undefined;
      if (precio === undefined) {
        throw new ErrorNegocio(
          422,
          'SIN_TARIFA',
          'Ese horario no tiene precio configurado: indicá el precio',
        );
      }
    }

    return this.conConflicto(clubId, p.canchaId, p.inicio, fin, async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      const cliente = await upsertCliente(tx, clubId, p.cliente);
      const turno = await insertarTurno(
        tx,
        {
          clubId,
          canchaId: p.canchaId,
          clienteId: cliente.id,
          inicio: p.inicio,
          fin,
          estado: 'CONFIRMADO',
          origen: 'MANUAL',
          precioTotal: precio,
          montoSena: 0,
          expiraEn: null,
          idempotencyKey: p.idempotencyKey,
          creadoPor: usuarioId,
          nota: p.nota,
        },
        this.e.reloj(),
        this.e.urlWeb,
      );
      if (p.notificar !== false) await notificarTurno(tx, turno.id, 'reserva_confirmada', this.e.urlWeb);
      return turno;
    });
  }

  /** Bloqueo de cancha (mantenimiento, evento): ocupa el horario sin cliente ni precio. */
  async bloquear(
    clubId: string,
    usuarioId: string,
    p: { canchaId: string; inicio: Date; fin: Date; motivo: string },
  ) {
    const { fin } = await this.validarRango(clubId, p.canchaId, p.inicio, p.fin);
    return this.conConflicto(clubId, p.canchaId, p.inicio, fin, async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      return insertarTurno(
        tx,
        {
          clubId,
          canchaId: p.canchaId,
          clienteId: null,
          inicio: p.inicio,
          fin,
          estado: 'CONFIRMADO',
          origen: 'BLOQUEO',
          precioTotal: 0,
          montoSena: 0,
          expiraEn: null,
          creadoPor: usuarioId,
          nota: p.motivo,
        },
        this.e.reloj(),
        this.e.urlWeb,
      );
    });
  }

  /**
   * Cancela un turno. Con `devolverSena`, cada seña aprobada queda registrada para
   * reembolso (Mercado Pago: automático por el worker; transferencia/efectivo: a mano).
   * Si el turno todavía no empezó, se le ofrece a la lista de espera.
   */
  async cancelar(
    clubId: string,
    usuarioId: string,
    turnoId: string,
    p: { motivo: string; devolverSena: boolean; notificar?: boolean | undefined },
  ) {
    return this.e.db.transaction(async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      const turno = await this.turnoDelClub(tx, clubId, turnoId);
      if (turno.estado !== 'PRE_RESERVADO' && turno.estado !== 'CONFIRMADO') {
        throw new ErrorNegocio(409, 'NO_CANCELABLE', `Un turno ${turno.estado} no se puede cancelar`);
      }
      const ahora = this.e.reloj();
      await tx
        .update(turnos)
        .set({ estado: 'CANCELADO', expiraEn: null, canceladoEn: ahora, motivoCancelacion: p.motivo })
        .where(eq(turnos.id, turnoId));
      await cerrarCheckoutsAbiertos(tx, [turnoId]);

      let devuelto = 0;
      if (p.devolverSena) {
        const senas = await tx
          .select({ id: pagos.id, monto: pagos.monto })
          .from(pagos)
          .where(and(eq(pagos.turnoId, turnoId), eq(pagos.concepto, 'SENA'), eq(pagos.estado, 'APROBADO')));
        for (const s of senas) {
          const [r] = await tx
            .insert(reembolsos)
            .values({ clubId, pagoId: s.id, monto: s.monto, motivo: 'TURNO_CANCELADO' })
            .onConflictDoNothing()
            .returning({ id: reembolsos.id });
          if (r) devuelto += s.monto;
        }
      }

      if (p.notificar !== false && turno.clienteId) {
        await notificarTurno(tx, turnoId, 'reserva_cancelada', this.e.urlWeb, {
          motivo: p.motivo,
          reembolso: devuelto > 0 ? `Te devolvemos la seña (${pesos(devuelto)}).` : '',
        });
      }

      const ofrecidoA =
        turno.inicio > ahora
          ? await this.e.listaEspera.ofrecer(tx, {
              id: turno.id,
              clubId,
              canchaId: turno.canchaId,
              clienteId: turno.clienteId,
              inicio: turno.inicio,
              fin: turno.fin,
            })
          : null;
      return { estado: 'CANCELADO' as const, senaADevolver: devuelto, ofertaListaEspera: ofrecidoA };
    });
  }

  async marcarAusente(clubId: string, usuarioId: string, turnoId: string) {
    return this.e.db.transaction(async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      const turno = await this.turnoDelClub(tx, clubId, turnoId);
      if (turno.estado !== 'CONFIRMADO') {
        throw new ErrorNegocio(
          409,
          'NO_CONFIRMADO',
          `Solo un turno CONFIRMADO puede quedar ausente (está ${turno.estado})`,
        );
      }
      if (turno.inicio > this.e.reloj()) {
        throw new ErrorNegocio(409, 'TURNO_NO_EMPEZO', 'El turno todavía no empezó');
      }
      await tx.update(turnos).set({ estado: 'AUSENTE' }).where(eq(turnos.id, turnoId));
      return this.resumen(tx, turnoId);
    });
  }

  /**
   * Check-in escaneando el QR del comprobante. Idempotente: escanear dos veces el mismo
   * QR devuelve el resumen con `yaRegistrado`. Devuelve lo que queda por cobrar.
   */
  async checkin(clubId: string, usuarioId: string, qr: string, { forzar = false } = {}) {
    const codigo = codigoDesdeQr(qr);
    if (!codigo) throw new ErrorNegocio(422, 'QR_INVALIDO', 'Ese QR no es de una reserva');

    return this.e.db.transaction(async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      const [sinBloqueo] = await tx
        .select({ id: turnos.id, clubId: turnos.clubId })
        .from(turnos)
        .where(eq(turnos.codigoCheckin, codigo));
      // Un QR de otro club se responde igual que uno inexistente.
      if (!sinBloqueo || sinBloqueo.clubId !== clubId) {
        throw new ErrorNegocio(404, 'RESERVA_NO_ENCONTRADA', 'No hay una reserva de este club con ese QR');
      }
      const turno = await bloquearTurno(tx, sinBloqueo.id);
      if (!turno) throw new Error('turno desapareció');

      if (turno.estado === 'PRESENTE') return { yaRegistrado: true, ...(await this.resumen(tx, turno.id)) };
      if (turno.estado !== 'CONFIRMADO') {
        throw new ErrorNegocio(
          409,
          'NO_CONFIRMADO',
          turno.estado === 'PRE_RESERVADO'
            ? 'La reserva todavía no tiene la seña paga: cobrala para confirmarla'
            : `La reserva está ${turno.estado}`,
          { estado: turno.estado },
        );
      }
      const ahora = this.e.reloj();
      const desde = new Date(turno.inicio.getTime() - CHECKIN_ANTICIPACION_MIN * 60_000);
      if (!forzar && (ahora < desde || ahora > turno.fin)) {
        throw new ErrorNegocio(409, 'FUERA_DE_HORARIO', 'La reserva es para otro horario', {
          inicio: turno.inicio.toISOString(),
          fin: turno.fin.toISOString(),
        });
      }
      await tx
        .update(turnos)
        .set({ estado: 'PRESENTE', checkinEn: ahora, checkinPor: usuarioId })
        .where(eq(turnos.id, turno.id));
      return { yaRegistrado: false, ...(await this.resumen(tx, turno.id)) };
    });
  }

  /**
   * Pago en el club (efectivo, transferencia mostrada en el celular, posnet). Si es la
   * seña de un turno PRE_RESERVADO, lo confirma.
   */
  async registrarPago(
    clubId: string,
    usuarioId: string,
    turnoId: string,
    p: { monto: number; medio: 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO'; concepto: 'SENA' | 'SALDO' },
  ) {
    return this.e.db.transaction(async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      const turno = await this.turnoDelClub(tx, clubId, turnoId);
      if (turno.estado === 'CANCELADO' || turno.origen === 'BLOQUEO') {
        throw new ErrorNegocio(409, 'NO_COBRABLE', 'Ese turno no admite cobros');
      }
      await tx.insert(pagos).values({
        clubId,
        turnoId,
        proveedor: p.medio,
        concepto: p.concepto,
        estado: 'APROBADO',
        monto: p.monto,
        revisadoPor: usuarioId,
        acreditadoEn: this.e.reloj(),
      });
      // La seña de una reserva pendiente (o vencida, si el horario sigue libre) la confirma:
      // mismo camino que un pago de Mercado Pago. Si el horario se perdió, rollback del cobro.
      if (p.concepto === 'SENA' && (turno.estado === 'PRE_RESERVADO' || turno.estado === 'EXPIRADO')) {
        const r = await confirmarSena(tx, turnoId);
        if (r === 'SLOT_PERDIDO') {
          throw new ErrorNegocio(
            409,
            'TURNO_OCUPADO',
            'La reserva venció y el horario ya lo tomó otra persona',
          );
        }
        if (r === 'CONFIRMADO') await notificarTurno(tx, turnoId, 'reserva_confirmada', this.e.urlWeb);
      }
      return this.resumen(tx, turnoId);
    });
  }

  async resumen(tx: Tx, turnoId: string): Promise<ResumenCobro> {
    const [f] = await tx
      .select({
        id: turnos.id,
        estado: turnos.estado,
        inicio: turnos.inicio,
        fin: turnos.fin,
        precioTotal: turnos.precioTotal,
        cancha: canchas.nombre,
        cliente: { nombre: clientes.nombre, telefono: clientes.telefonoE164 },
        pagado: sql<string>`(
          SELECT coalesce(sum(${pagos.monto}), 0) FROM ${pagos}
           WHERE ${pagos.turnoId} = ${turnos.id} AND ${pagos.estado} = 'APROBADO'
             AND NOT EXISTS (SELECT 1 FROM ${reembolsos} r WHERE r.pago_id = ${pagos.id}))`,
      })
      .from(turnos)
      .innerJoin(canchas, eq(canchas.id, turnos.canchaId))
      .leftJoin(clientes, eq(clientes.id, turnos.clienteId))
      .where(eq(turnos.id, turnoId));
    if (!f) throw new ErrorNegocio(404, 'TURNO_NO_ENCONTRADO', 'No existe ese turno');
    const pagado = Number(f.pagado);
    return {
      turnoId: f.id,
      estado: f.estado,
      inicio: f.inicio.toISOString(),
      fin: f.fin.toISOString(),
      cancha: f.cancha,
      cliente: f.cliente?.nombre ? { nombre: f.cliente.nombre, telefono: f.cliente.telefono } : null,
      precioTotal: f.precioTotal,
      pagado,
      saldo: Math.max(f.precioTotal - pagado, 0),
    };
  }

  // ---------------------------------------------------------------------------

  /** Bloquea el turno y verifica que sea de este club (si no, 404 como si no existiera). */
  private async turnoDelClub(tx: Tx, clubId: string, turnoId: string) {
    const turno = await bloquearTurno(tx, turnoId);
    if (!turno || turno.clubId !== clubId)
      throw new ErrorNegocio(404, 'TURNO_NO_ENCONTRADO', 'No existe ese turno');
    return turno;
  }

  private async validarRango(clubId: string, canchaId: string, inicio: Date, fin?: Date) {
    const cfg = await this.e.clubs.porId(clubId);
    const cancha = cfg?.canchas.find((c) => c.id === canchaId);
    if (!cancha) throw new ErrorNegocio(404, 'CANCHA_NO_ENCONTRADA', 'La cancha no existe en este club');
    const hasta = fin ?? new Date(inicio.getTime() + cancha.duracionTurnoMin * 60_000);
    const minutos = (hasta.getTime() - inicio.getTime()) / 60_000;
    if (minutos <= 0 || minutos > MAX_DURACION_MIN) {
      throw new ErrorNegocio(422, 'DURACION_INVALIDA', 'La duración tiene que ser de hasta 6 horas');
    }
    if (inicio.getTime() < this.e.reloj().getTime() - CARGA_RETROACTIVA_MIN * 60_000) {
      throw new ErrorNegocio(422, 'HORARIO_PASADO', 'No se pueden cargar turnos de hace más de 3 horas');
    }
    return { cancha, fin: hasta };
  }

  /** Ejecuta el alta y, si el horario está ocupado, responde qué turno lo ocupa. */
  private async conConflicto<T>(
    clubId: string,
    canchaId: string,
    inicio: Date,
    fin: Date,
    fn: (tx: Tx) => Promise<T>,
  ) {
    try {
      return await this.e.db.transaction(fn);
    } catch (err) {
      if (!esTurnoOcupado(err)) throw err;
      const ocupantes = await this.e.db
        .select({
          id: turnos.id,
          inicio: turnos.inicio,
          fin: turnos.fin,
          estado: turnos.estado,
          origen: turnos.origen,
          cliente: clientes.nombre,
        })
        .from(turnos)
        .leftJoin(clientes, eq(clientes.id, turnos.clienteId))
        .where(
          and(
            eq(turnos.clubId, clubId),
            eq(turnos.canchaId, canchaId),
            inArray(turnos.estado, ['PRE_RESERVADO', 'CONFIRMADO', 'PRESENTE', 'AUSENTE']),
            sql`${turnos.rango} && tstzrange(${inicio.toISOString()}::timestamptz, ${fin.toISOString()}::timestamptz, '[)')`,
          ),
        );
      throw new ErrorNegocio(409, 'TURNO_OCUPADO', 'Ese horario se superpone con otro turno', {
        conflictos: ocupantes.map((o) => ({
          ...o,
          inicio: o.inicio.toISOString(),
          fin: o.fin.toISOString(),
        })),
      });
    }
  }
}
