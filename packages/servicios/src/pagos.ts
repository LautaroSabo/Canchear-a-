import { randomUUID } from 'node:crypto';
import { type Tx, violaUnique } from '@cancheria/db';
import { canchas, clubs, pagos, reembolsos, turnos } from '@cancheria/db/schema';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { type AlmacenArchivos, detectarTipoComprobante, TAMANO_MAXIMO_COMPROBANTE } from './almacen.ts';
import type { Cifrador } from './cifrado.ts';
import { leerCredencialesMp } from './credenciales.ts';
import { type Entorno, linkComprobante } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';
import { fechaCorta, horaCorta } from './formato.ts';
import type { PagoMp, PasarelaMp } from './mercadopago/pasarela.ts';
import {
  bloquearTurno,
  confirmarSena,
  notificarTurno,
  type ResultadoConfirmacion,
  setActor,
} from './turnos.ts';

export interface EntornoPagos extends Entorno {
  pasarela: PasarelaMp;
  cifrador: Cifrador;
  almacen: AlmacenArchivos;
  /** URL pública de la API (notification_url de Mercado Pago). */
  urlApi: string;
}

type EstadoPago = 'PENDIENTE' | 'EN_REVISION' | 'APROBADO' | 'RECHAZADO' | 'REEMBOLSADO';

export type ResultadoPago =
  | { tipo: 'IGNORADO'; motivo: string }
  | { tipo: 'SIN_CAMBIOS' }
  | { tipo: 'ESTADO'; estado: EstadoPago }
  | { tipo: 'CONFIRMADO'; turnoId: string }
  | { tipo: 'REEMBOLSO'; motivo: MotivoReembolso };

export type MotivoReembolso = 'PAGO_TARDIO' | 'PAGO_DUPLICADO' | 'MONTO_INSUFICIENTE' | 'TURNO_CANCELADO';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function estadoDesdeMp(estado: PagoMp['estado']): EstadoPago {
  switch (estado) {
    case 'approved':
      return 'APROBADO';
    case 'refunded':
    case 'charged_back':
      return 'REEMBOLSADO';
    case 'rejected':
    case 'cancelled':
      return 'RECHAZADO';
    default:
      return 'PENDIENTE';
  }
}

const motivoPorConfirmacion: Partial<Record<ResultadoConfirmacion, MotivoReembolso>> = {
  SLOT_PERDIDO: 'PAGO_TARDIO',
  CANCELADO: 'TURNO_CANCELADO',
};

export class ServicioPagos {
  constructor(private readonly e: EntornoPagos) {}

  // ---------------------------------------------------------------------------
  // Mercado Pago
  // ---------------------------------------------------------------------------

  /**
   * Link de pago de la seña. Reusa la preferencia si ya existe: dos clics en "Pagar" o
   * volver al link no crean preferencias nuevas. Vence junto con el hold.
   */
  async checkoutMp(codigo: string): Promise<{ urlCheckout: string }> {
    const t = await this.turnoPendiente(codigo);
    const cred = await leerCredencialesMp(this.e.db, this.e.cifrador, t.clubId);
    if (!cred) throw new ErrorNegocio(422, 'MP_NO_DISPONIBLE', 'El club no tiene Mercado Pago configurado');

    const abierto = await this.pagoAbiertoMp(t.id);
    if (abierto?.urlCheckout) {
      const vence = (abierto.payload as { vence?: string } | null)?.vence;
      if (abierto.externalId || vence === t.expiraEn.toISOString())
        return { urlCheckout: abierto.urlCheckout };
      // La reserva se extendió (p. ej. se subió y se rechazó una transferencia): el link
      // viejo vence antes que ella y MP rechazaría el pago. Se cierra y se crea otro.
      await this.e.db
        .update(pagos)
        .set({ estado: 'RECHAZADO' })
        .where(and(eq(pagos.id, abierto.id), eq(pagos.estado, 'PENDIENTE'), isNull(pagos.externalId)));
    }

    const pref = await this.crearPreferencia(cred.accessToken, {
      titulo: `Seña ${t.cancha} ${fechaCorta(t.inicio, t.zona)} ${horaCorta(t.inicio, t.zona)} — ${t.club}`,
      monto: t.montoSena,
      moneda: t.moneda,
      referenciaExterna: t.id,
      vence: t.expiraEn,
      urlNotificacion: `${this.e.urlApi.replace(/\/$/, '')}/webhooks/mercadopago/${t.slug}`,
      urlRetorno: linkComprobante(this.e.urlWeb, codigo),
      idempotencia: `pref-${t.id}-${t.expiraEn.getTime()}`,
    });
    try {
      await this.e.db.insert(pagos).values({
        clubId: t.clubId,
        turnoId: t.id,
        proveedor: 'MERCADO_PAGO',
        concepto: 'SENA',
        estado: 'PENDIENTE',
        monto: t.montoSena,
        preferenciaId: pref.id,
        urlCheckout: pref.urlCheckout,
        // Hasta cuándo acepta pagos esta preferencia (se compara al reusarla).
        payload: { vence: t.expiraEn.toISOString() },
      });
    } catch (err) {
      // Dos pedidos simultáneos: gana el primero y el segundo devuelve el mismo link.
      if (!violaUnique(err, 'pagos_sena_abierta_uq')) throw err;
      const ganador = await this.pagoAbiertoMp(t.id);
      if (ganador?.urlCheckout) return { urlCheckout: ganador.urlCheckout };
    }
    return { urlCheckout: pref.urlCheckout };
  }

  /** MP caído o con credenciales inválidas: error claro y una salida para el cliente. */
  private async crearPreferencia(token: string, datos: Parameters<PasarelaMp['crearPreferencia']>[1]) {
    try {
      return await this.e.pasarela.crearPreferencia(token, datos);
    } catch (err) {
      throw new ErrorNegocio(
        502,
        'MP_SIN_RESPUESTA',
        'Mercado Pago no responde en este momento. Probá de nuevo en unos minutos o pagá por transferencia.',
        undefined,
        err,
      );
    }
  }

  /** Webhook: nunca se confía en el cuerpo, se consulta el pago a la API de MP. */
  async procesarNotificacionMp(clubId: string, pagoId: string): Promise<ResultadoPago> {
    const cred = await leerCredencialesMp(this.e.db, this.e.cifrador, clubId);
    if (!cred) return { tipo: 'IGNORADO', motivo: 'club sin credenciales' };
    const pago = await this.e.pasarela.obtenerPago(cred.accessToken, pagoId);
    if (!pago) return { tipo: 'IGNORADO', motivo: 'pago inexistente en MP' };
    return this.procesarPagoMp(clubId, pago);
  }

  /**
   * Conciliación: pregunta a MP por los pagos de un turno. El worker lo usa antes de
   * expirar un hold con checkout abierto, por si el webhook se demoró o se perdió.
   */
  async conciliarTurno(clubId: string, turnoId: string): Promise<ResultadoPago[]> {
    const cred = await leerCredencialesMp(this.e.db, this.e.cifrador, clubId);
    if (!cred) return [];
    const encontrados = await this.e.pasarela.buscarPagos(cred.accessToken, turnoId);
    const resultados: ResultadoPago[] = [];
    for (const p of encontrados) resultados.push(await this.procesarPagoMp(clubId, p));
    return resultados;
  }

  /**
   * Aplica el estado actual de un pago de MP. Idempotente: el mismo pago procesado N
   * veces (webhooks repetidos, conciliación) produce el efecto una sola vez.
   */
  async procesarPagoMp(clubId: string, pago: PagoMp): Promise<ResultadoPago> {
    const ref = pago.referenciaExterna;
    if (!ref || !UUID.test(ref)) return { tipo: 'IGNORADO', motivo: 'sin referencia de turno' };
    const nuevo = estadoDesdeMp(pago.estado);

    return this.e.db.transaction(async (tx) => {
      await setActor(tx, 'webhook:mp');
      const turno = await bloquearTurno(tx, ref);
      if (!turno || turno.clubId !== clubId)
        return { tipo: 'IGNORADO', motivo: 'turno de otro club o inexistente' };

      const fila = await this.registrarPagoMp(tx, turno.id, clubId, pago, nuevo);
      if (!fila) return { tipo: 'SIN_CAMBIOS' };
      if (nuevo !== 'APROBADO') return { tipo: 'ESTADO', estado: nuevo };

      const [club] = await tx.select({ moneda: clubs.moneda }).from(clubs).where(eq(clubs.id, clubId));
      if (pago.moneda !== club?.moneda || pago.monto < turno.montoSena) {
        return this.reembolsar(tx, fila.id, clubId, pago.monto, 'MONTO_INSUFICIENTE');
      }
      return this.aplicarSenaAprobada(tx, turno.id, fila.id, clubId, pago.monto);
    });
  }

  /** Inserta o actualiza la fila de `pagos`; null si ya tenía ese estado (nada que hacer). */
  private async registrarPagoMp(tx: Tx, turnoId: string, clubId: string, pago: PagoMp, nuevo: EstadoPago) {
    const cambios = {
      estado: nuevo,
      monto: pago.monto,
      payload: pago.bruto,
      acreditadoEn: nuevo === 'APROBADO' ? (pago.aprobadoEn ?? this.e.reloj()) : null,
    };
    const [existente] = await tx
      .select({ id: pagos.id, estado: pagos.estado, turnoId: pagos.turnoId })
      .from(pagos)
      .where(and(eq(pagos.proveedor, 'MERCADO_PAGO'), eq(pagos.externalId, pago.id)));
    if (existente) {
      // Un pago de MP pertenece a un solo turno: si figura en otro, no se toca nada.
      if (existente.turnoId !== turnoId) return null;
      if (existente.estado === nuevo) return null;
      await tx.update(pagos).set(cambios).where(eq(pagos.id, existente.id));
      return existente;
    }
    // Primer aviso de este pago: completa la fila que se creó junto con la preferencia.
    const [completada] = await tx
      .update(pagos)
      .set({ ...cambios, externalId: pago.id })
      .where(
        and(
          eq(pagos.turnoId, turnoId),
          eq(pagos.proveedor, 'MERCADO_PAGO'),
          eq(pagos.concepto, 'SENA'),
          eq(pagos.estado, 'PENDIENTE'),
          isNull(pagos.externalId),
        ),
      )
      .returning({ id: pagos.id, estado: pagos.estado });
    if (completada) return completada;
    const [insertada] = await tx
      .insert(pagos)
      .values({
        clubId,
        turnoId,
        proveedor: 'MERCADO_PAGO',
        concepto: 'SENA',
        externalId: pago.id,
        ...cambios,
      })
      .returning({ id: pagos.id, estado: pagos.estado });
    return insertada ?? null;
  }

  /** Confirma el turno con una seña acreditada o, si no corresponde, la devuelve. */
  private async aplicarSenaAprobada(
    tx: Tx,
    turnoId: string,
    pagoId: string,
    clubId: string,
    monto: number,
  ): Promise<ResultadoPago> {
    const r = await confirmarSena(tx, turnoId);
    if (r === 'CONFIRMADO') {
      await notificarTurno(tx, turnoId, 'reserva_confirmada', this.e.urlWeb);
      return { tipo: 'CONFIRMADO', turnoId };
    }
    if (r === 'YA_CONFIRMADO') {
      // Segundo pago de la misma seña (pagó dos veces, o por MP y por transferencia).
      const [otro] = await tx
        .select({ id: pagos.id })
        .from(pagos)
        .where(
          and(
            eq(pagos.turnoId, turnoId),
            eq(pagos.concepto, 'SENA'),
            eq(pagos.estado, 'APROBADO'),
            ne(pagos.id, pagoId),
          ),
        );
      return otro ? this.reembolsar(tx, pagoId, clubId, monto, 'PAGO_DUPLICADO') : { tipo: 'SIN_CAMBIOS' };
    }
    return this.reembolsar(tx, pagoId, clubId, monto, motivoPorConfirmacion[r] ?? 'PAGO_TARDIO');
  }

  /** Registra el reembolso (lo ejecuta el worker). Un pago se devuelve una sola vez. */
  private async reembolsar(tx: Tx, pagoId: string, clubId: string, monto: number, motivo: MotivoReembolso) {
    await tx.insert(reembolsos).values({ clubId, pagoId, monto, motivo }).onConflictDoNothing();
    return { tipo: 'REEMBOLSO', motivo } as const;
  }

  // ---------------------------------------------------------------------------
  // Transferencia con comprobante
  // ---------------------------------------------------------------------------

  /**
   * El cliente sube el comprobante: el pago queda EN_REVISION y el hold se extiende
   * `minutos_revision_transferencia` (sin pasar del inicio) para que el club lo revise.
   */
  async registrarTransferencia(codigo: string, archivo: Buffer) {
    const t = await this.turnoPendiente(codigo);
    if (!t.tieneTransferencia) {
      throw new ErrorNegocio(422, 'TRANSFERENCIA_NO_DISPONIBLE', 'El club no acepta transferencias');
    }
    if (archivo.length > TAMANO_MAXIMO_COMPROBANTE) {
      throw new ErrorNegocio(413, 'ARCHIVO_DEMASIADO_GRANDE', 'El comprobante no puede superar 5 MB');
    }
    const tipo = detectarTipoComprobante(archivo);
    if (!tipo) throw new ErrorNegocio(422, 'ARCHIVO_INVALIDO', 'Subí una foto (JPG, PNG, WEBP) o un PDF');

    const clave = `comprobantes/${t.clubId}/${t.id}/${randomUUID()}.${tipo.extension}`;
    await this.e.almacen.guardar(clave, archivo, tipo.mime);
    try {
      return await this.e.db.transaction(async (tx) => {
        await setActor(tx, 'cliente');
        const turno = await bloquearTurno(tx, t.id);
        const ahora = this.e.reloj();
        if (turno?.estado !== 'PRE_RESERVADO' || !turno.expiraEn || turno.expiraEn <= ahora) {
          throw new ErrorNegocio(409, 'RESERVA_NO_PENDIENTE', 'La reserva ya no está esperando la seña');
        }
        await tx.insert(pagos).values({
          clubId: t.clubId,
          turnoId: t.id,
          proveedor: 'TRANSFERENCIA',
          concepto: 'SENA',
          estado: 'EN_REVISION',
          monto: t.montoSena,
          comprobanteUrl: clave,
        });
        const extendida = new Date(
          Math.min(
            Math.max(turno.expiraEn.getTime(), ahora.getTime() + t.minutosRevision * 60_000),
            turno.inicio.getTime(),
          ),
        );
        await tx.update(turnos).set({ expiraEn: extendida }).where(eq(turnos.id, t.id));
        return { estado: 'EN_REVISION' as const, expiraEn: extendida.toISOString() };
      });
    } catch (err) {
      await this.e.almacen.borrar(clave);
      if (violaUnique(err, 'pagos_sena_abierta_uq')) {
        throw new ErrorNegocio(409, 'COMPROBANTE_EN_REVISION', 'Ya hay un comprobante esperando revisión');
      }
      throw err;
    }
  }

  /** El club valida la transferencia. Las devoluciones de transferencias se hacen a mano. */
  async aprobarTransferencia(clubId: string, pagoId: string, usuarioId: string): Promise<ResultadoPago> {
    return this.e.db.transaction(async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      const pago = await this.transferenciaEnRevision(tx, clubId, pagoId);
      await tx
        .update(pagos)
        .set({ estado: 'APROBADO', revisadoPor: usuarioId, acreditadoEn: this.e.reloj() })
        .where(eq(pagos.id, pagoId));
      return this.aplicarSenaAprobada(tx, pago.turnoId, pagoId, pago.clubId, pago.monto);
    });
  }

  async rechazarTransferencia(clubId: string, pagoId: string, usuarioId: string, motivo: string) {
    await this.e.db.transaction(async (tx) => {
      await setActor(tx, `usuario:${usuarioId}`);
      const pago = await this.transferenciaEnRevision(tx, clubId, pagoId);
      await tx
        .update(pagos)
        .set({ estado: 'RECHAZADO', revisadoPor: usuarioId, payload: { motivoRechazo: motivo } })
        .where(eq(pagos.id, pagoId));
      await notificarTurno(tx, pago.turnoId, 'transferencia_rechazada', this.e.urlWeb, { motivo });
    });
  }

  /** Bloquea turno → pago (mismo orden que el webhook, para no generar deadlocks). */
  private async transferenciaEnRevision(tx: Tx, clubId: string, pagoId: string) {
    const [sinBloqueo] = await tx
      .select({ turnoId: pagos.turnoId, clubId: pagos.clubId })
      .from(pagos)
      .where(eq(pagos.id, pagoId));
    // Un pago de otro club se responde igual que uno inexistente.
    if (!sinBloqueo || sinBloqueo.clubId !== clubId) {
      throw new ErrorNegocio(404, 'PAGO_NO_ENCONTRADO', 'No existe ese pago');
    }
    await bloquearTurno(tx, sinBloqueo.turnoId);
    const [pago] = await tx.select().from(pagos).where(eq(pagos.id, pagoId)).for('update');
    if (pago?.proveedor !== 'TRANSFERENCIA' || pago.estado !== 'EN_REVISION') {
      throw new ErrorNegocio(409, 'PAGO_NO_EN_REVISION', 'Ese pago no está esperando revisión');
    }
    return pago;
  }

  // ---------------------------------------------------------------------------
  // Ofertas de la lista de espera sin seña
  // ---------------------------------------------------------------------------

  /** Acepta un turno ofrecido que no pide seña (el hold espera la confirmación). */
  async confirmarSinSena(codigo: string) {
    const t = await this.turnoPendiente(codigo, { conSena: false });
    await this.e.db.transaction(async (tx) => {
      await setActor(tx, 'cliente');
      const r = await confirmarSena(tx, t.id);
      if (r !== 'CONFIRMADO')
        throw new ErrorNegocio(409, 'RESERVA_NO_PENDIENTE', 'La reserva ya no está pendiente');
      await notificarTurno(tx, t.id, 'reserva_confirmada', this.e.urlWeb);
    });
  }

  // ---------------------------------------------------------------------------

  private async pagoAbiertoMp(turnoId: string) {
    const [p] = await this.e.db
      .select({
        id: pagos.id,
        urlCheckout: pagos.urlCheckout,
        externalId: pagos.externalId,
        payload: pagos.payload,
      })
      .from(pagos)
      .where(
        and(
          eq(pagos.turnoId, turnoId),
          eq(pagos.proveedor, 'MERCADO_PAGO'),
          eq(pagos.concepto, 'SENA'),
          eq(pagos.estado, 'PENDIENTE'),
        ),
      );
    return p ?? null;
  }

  /** Turno PRE_RESERVADO y vigente, con lo necesario para cobrarlo. */
  private async turnoPendiente(codigo: string, { conSena = true } = {}) {
    const [t] = await this.e.db
      .select({
        id: turnos.id,
        clubId: turnos.clubId,
        estado: turnos.estado,
        inicio: turnos.inicio,
        expiraEn: turnos.expiraEn,
        montoSena: turnos.montoSena,
        cancha: canchas.nombre,
        club: clubs.nombre,
        slug: clubs.slug,
        zona: clubs.zonaHoraria,
        moneda: clubs.moneda,
        minutosRevision: clubs.minutosRevisionTransferencia,
        tieneTransferencia: sql<boolean>`${clubs.datosTransferencia} IS NOT NULL`,
      })
      .from(turnos)
      .innerJoin(canchas, eq(canchas.id, turnos.canchaId))
      .innerJoin(clubs, eq(clubs.id, turnos.clubId))
      .where(eq(turnos.codigoCheckin, codigo));
    if (!t) throw new ErrorNegocio(404, 'RESERVA_NO_ENCONTRADA', 'No encontramos esa reserva');
    if (t.estado !== 'PRE_RESERVADO' || !t.expiraEn || t.expiraEn <= this.e.reloj()) {
      throw new ErrorNegocio(409, 'RESERVA_NO_PENDIENTE', 'La reserva ya no está esperando la seña');
    }
    if (conSena && t.montoSena === 0) {
      throw new ErrorNegocio(
        409,
        'SIN_SENA',
        'Esta reserva no requiere seña: confirmala desde el comprobante',
      );
    }
    if (!conSena && t.montoSena > 0) {
      throw new ErrorNegocio(409, 'REQUIERE_SENA', 'Esta reserva se confirma pagando la seña');
    }
    return { ...t, expiraEn: t.expiraEn };
  }
}
