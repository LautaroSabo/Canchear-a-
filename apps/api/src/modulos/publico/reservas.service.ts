import { calcularExpiracion, partesLocales, sumarDias, sumarMinutos } from '@cancheria/core';
import { type Db, esTurnoOcupado, violaUnique } from '@cancheria/db';
import { canchas, clientes, clubs, pagos, turnos } from '@cancheria/db/schema';
import {
  type Cancha,
  type ConfigClub,
  cotizarTurno,
  ErrorNegocio,
  type Reloj,
  registrarExpiraciones,
  setActor,
  telefonoValido,
  upsertCliente,
} from '@cancheria/servicios';
import { and, eq, lte, type SQL, sql } from 'drizzle-orm';
import type { Config } from '../../config.ts';
import type { ServicioDisponibilidad } from './disponibilidad.service.ts';
import type { CuerpoReserva } from './esquemas.ts';

export type EstadoPublico =
  | 'PRE_RESERVADO'
  | 'CONFIRMADO'
  | 'PRESENTE'
  | 'AUSENTE'
  | 'CANCELADO'
  | 'EXPIRADO';

export interface ReservaPublica {
  /** Token secreto de la reserva: identifica la URL del comprobante y va dentro del QR. */
  codigo: string;
  estado: EstadoPublico;
  club: { slug: string; nombre: string };
  cancha: { id: string; nombre: string };
  inicio: string;
  fin: string;
  precioTotal: number;
  montoSena: number;
  saldoAPagar: number;
  /** Solo en PRE_RESERVADO: hasta cuándo se espera la seña. */
  expiraEn: string | null;
  /** Hay un comprobante de transferencia esperando que el club lo revise. */
  senaEnRevision: boolean;
  cliente: { nombre: string };
}

export interface Alternativa {
  canchaId: string;
  cancha: string;
  inicio: string;
  fin: string;
  precio: number;
}

export class ServicioReservas {
  constructor(
    private readonly db: Db,
    private readonly reloj: Reloj,
    private readonly config: Pick<Config, 'anticipacionMinimaMin' | 'urlWeb'>,
    private readonly disponibilidad: ServicioDisponibilidad,
  ) {}

  /**
   * Reserva pública. Todas las validaciones de negocio se hacen antes de abrir la
   * transacción; la transacción es corta y el árbitro final de la concurrencia es la
   * exclusion constraint `turnos_sin_solapamiento` (ver docs/arquitectura.md §3).
   */
  async crear(cfg: ConfigClub, pedido: CuerpoReserva): Promise<{ reserva: ReservaPublica; creada: boolean }> {
    const ahora = this.reloj();

    const cancha = cfg.canchas.find((c) => c.id === pedido.canchaId);
    if (!cancha) throw new ErrorNegocio(404, 'CANCHA_NO_ENCONTRADA', 'La cancha no existe en este club');

    telefonoValido(pedido.cliente.telefono);

    const inicio = new Date(pedido.inicio);
    const { slot, fecha } = this.buscarSlot(cfg, cancha, inicio);
    if (inicio < sumarMinutos(ahora, this.config.anticipacionMinimaMin)) {
      throw new ErrorNegocio(422, 'HORARIO_PASADO', 'Ese horario ya pasó');
    }

    const cotizacion = cotizarTurno(cfg, cancha, inicio);
    if (!cotizacion) throw new ErrorNegocio(422, 'SIN_TARIFA', 'Ese horario no tiene precio configurado');

    const expiracion = calcularExpiracion(ahora, inicio, cotizacion.regla, cotizacion.montoSena);
    if (expiracion.tipo === 'MUY_CERCA') {
      throw new ErrorNegocio(
        422,
        'RESERVA_MUY_CERCANA',
        'El turno empieza muy pronto para reservarlo online: comunicate con el club',
        { telefono: cfg.club.telefono },
      );
    }
    const conSena = expiracion.tipo === 'HOLD';

    try {
      const { turno, cliente } = await this.db.transaction(async (tx) => {
        await setActor(tx, 'cliente');
        const cliente = await upsertCliente(tx, cfg.club.id, pedido.cliente);

        // Expiración perezosa: un hold vencido que pisa este rango se libera acá mismo
        // (con los mismos efectos que si lo liberara el worker: aviso y checkout cerrado).
        const vencidos = await tx
          .update(turnos)
          .set({ estado: 'EXPIRADO', expiraEn: null })
          .where(
            and(
              eq(turnos.canchaId, cancha.id),
              eq(turnos.estado, 'PRE_RESERVADO'),
              lte(turnos.expiraEn, ahora),
              sql`${turnos.rango} && tstzrange(${slot.inicio.toISOString()}::timestamptz, ${slot.fin.toISOString()}::timestamptz, '[)')`,
            ),
          )
          .returning({ id: turnos.id });
        await registrarExpiraciones(
          tx,
          vencidos.map((v) => v.id),
          this.config.urlWeb,
        );

        const [turno] = await tx
          .insert(turnos)
          .values({
            clubId: cfg.club.id,
            canchaId: cancha.id,
            clienteId: cliente.id,
            inicio: slot.inicio,
            fin: slot.fin,
            estado: conSena ? 'PRE_RESERVADO' : 'CONFIRMADO',
            origen: 'WEB',
            precioTotal: cotizacion.precio,
            montoSena: conSena ? cotizacion.montoSena : 0,
            expiraEn: conSena ? expiracion.expiraEn : null,
            idempotencyKey: pedido.idempotencyKey,
          })
          .returning();
        if (!turno) throw new Error('insert de turno sin filas');
        return { turno, cliente };
      });

      return {
        creada: true,
        reserva: {
          codigo: turno.codigoCheckin,
          estado: estadoPublico(turno.estado, turno.expiraEn, ahora),
          club: { slug: cfg.club.slug, nombre: cfg.club.nombre },
          cancha: { id: cancha.id, nombre: cancha.nombre },
          inicio: turno.inicio.toISOString(),
          fin: turno.fin.toISOString(),
          precioTotal: turno.precioTotal,
          montoSena: turno.montoSena,
          saldoAPagar: turno.precioTotal - turno.montoSena,
          expiraEn: turno.expiraEn?.toISOString() ?? null,
          senaEnRevision: false,
          cliente: { nombre: cliente.nombre },
        },
      };
    } catch (e) {
      // Doble clic o reintento de red: se devuelve la reserva que ya se creó. Con dos
      // requests simultáneas, la segunda puede chocar primero con la exclusion constraint
      // (23P01) en vez de con el índice de idempotencia, así que se mira en ambos casos.
      if (esTurnoOcupado(e) || violaUnique(e, 'turnos_idempotency_uq')) {
        const previa = await this.buscar(
          and(eq(turnos.clubId, cfg.club.id), eq(turnos.idempotencyKey, pedido.idempotencyKey)),
        );
        if (previa) return { creada: false, reserva: previa };
      }
      if (esTurnoOcupado(e)) {
        throw new ErrorNegocio(409, 'TURNO_OCUPADO', 'Ese turno se acaba de ocupar', {
          alternativas: await this.alternativas(cfg, cancha, fecha, inicio),
        });
      }
      throw e;
    }
  }

  async porCodigo(codigo: string): Promise<ReservaPublica> {
    const reserva = await this.buscar(eq(turnos.codigoCheckin, codigo));
    if (!reserva) throw new ErrorNegocio(404, 'RESERVA_NO_ENCONTRADA', 'No encontramos esa reserva');
    return reserva;
  }

  private async buscar(condicion: SQL | undefined): Promise<ReservaPublica | null> {
    const [fila] = await this.db
      .select({
        turno: turnos,
        cancha: { id: canchas.id, nombre: canchas.nombre },
        club: { slug: clubs.slug, nombre: clubs.nombre },
        cliente: { nombre: clientes.nombre },
        senaEnRevision: sql<boolean>`EXISTS (SELECT 1 FROM ${pagos} WHERE ${pagos.turnoId} = ${turnos.id} AND ${pagos.estado} = 'EN_REVISION')`,
      })
      .from(turnos)
      .innerJoin(canchas, eq(canchas.id, turnos.canchaId))
      .innerJoin(clubs, eq(clubs.id, turnos.clubId))
      .innerJoin(clientes, eq(clientes.id, turnos.clienteId))
      .where(condicion);
    if (!fila) return null;
    const { turno } = fila;
    return {
      codigo: turno.codigoCheckin,
      estado: estadoPublico(turno.estado, turno.expiraEn, this.reloj()),
      club: fila.club,
      cancha: fila.cancha,
      inicio: turno.inicio.toISOString(),
      fin: turno.fin.toISOString(),
      precioTotal: turno.precioTotal,
      montoSena: turno.montoSena,
      saldoAPagar: turno.precioTotal - turno.montoSena,
      expiraEn: turno.expiraEn?.toISOString() ?? null,
      senaEnRevision: fila.senaEnRevision,
      cliente: fila.cliente,
    };
  }

  /**
   * El inicio tiene que coincidir con un turno de la grilla: el de la jornada de esa
   * fecha o, para la madrugada, el de la jornada anterior (sábado 09:00 → domingo 02:00).
   */
  private buscarSlot(cfg: ConfigClub, cancha: Cancha, inicio: Date) {
    const fechaLocal = partesLocales(inicio, cfg.club.zonaHoraria).fecha;
    for (const fecha of [fechaLocal, sumarDias(fechaLocal, -1)]) {
      const slot = this.disponibilidad
        .slotsDeCancha(cfg, cancha, fecha)
        .find((s) => s.inicio.getTime() === inicio.getTime());
      if (slot) {
        this.disponibilidad.validarFecha(cfg, fecha);
        return { slot, fecha };
      }
    }
    throw new ErrorNegocio(422, 'HORARIO_INVALIDO', 'Ese horario no está en la grilla de la cancha');
  }

  /** Hasta 5 turnos libres del mismo tipo de cancha, los más cercanos al pedido primero. */
  private async alternativas(
    cfg: ConfigClub,
    cancha: Cancha,
    fecha: string,
    inicio: Date,
  ): Promise<Alternativa[]> {
    const jornada = await this.disponibilidad.jornada(cfg, fecha, { jugadores: cancha.jugadoresPorLado });
    const t = inicio.getTime();
    return jornada
      .flatMap((c) =>
        c.slots
          .filter((s) => s.estado === 'LIBRE')
          .map((s) => ({ canchaId: c.id, cancha: c.nombre, inicio: s.inicio, fin: s.fin, precio: s.precio })),
      )
      .sort(
        (a, b) =>
          Math.abs(Date.parse(a.inicio) - t) - Math.abs(Date.parse(b.inicio) - t) ||
          Number(b.canchaId === cancha.id) - Number(a.canchaId === cancha.id),
      )
      .slice(0, 5);
  }
}

function estadoPublico(estado: EstadoPublico, expiraEn: Date | null, ahora: Date): EstadoPublico {
  return estado === 'PRE_RESERVADO' && expiraEn && expiraEn <= ahora ? 'EXPIRADO' : estado;
}
