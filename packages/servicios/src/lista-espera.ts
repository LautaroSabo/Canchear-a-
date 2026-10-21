import { calcularExpiracion, type ReglaSena } from '@cancheria/core';
import { esTurnoOcupado, type Tx } from '@cancheria/db';
import { clientes, listaEspera, turnos } from '@cancheria/db/schema';
import { and, eq, gte, lte, ne, sql } from 'drizzle-orm';
import { type DatosCliente, upsertCliente } from './clientes.ts';
import type { ConfigClub, RepoClubs } from './config-club.ts';
import { cotizarTurno } from './cotizacion.ts';
import type { Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';
import { notificarTurno, setActor } from './turnos.ts';

export interface PedidoListaEspera {
  cliente: DatosCliente;
  /** Ventana en la que le sirve jugar (cualquier turno que entre completo en ella). */
  desde: Date;
  hasta: Date;
  canchaId?: string | undefined;
  jugadoresPorLado?: number | undefined;
}

/** Timer de una oferta cuando el horario no pide seña (igual hay que aceptarla). */
const REGLA_OFERTA_SIN_SENA: ReglaSena = {
  canchaId: null,
  diaSemana: null,
  horaDesde: null,
  horaHasta: null,
  requiereSena: true,
  tipoSena: 'PORCENTAJE',
  valorSena: 0,
  minutosExpiracion: 30,
  margenMinAntesInicio: 15,
  prioridad: 0,
  activa: true,
};

export interface TurnoLiberado {
  id: string;
  clubId: string;
  canchaId: string;
  clienteId: string | null;
  inicio: Date;
  fin: Date;
}

export class ServicioListaEspera {
  constructor(private readonly e: Entorno & { clubs: RepoClubs }) {}

  async inscribir(cfg: ConfigClub, p: PedidoListaEspera) {
    if (p.hasta <= p.desde)
      throw new ErrorNegocio(422, 'VENTANA_INVALIDA', '"hasta" tiene que ser después de "desde"');
    if (p.hasta <= this.e.reloj())
      throw new ErrorNegocio(422, 'VENTANA_PASADA', 'Esa franja horaria ya pasó');
    if (p.canchaId && !cfg.canchas.some((c) => c.id === p.canchaId)) {
      throw new ErrorNegocio(404, 'CANCHA_NO_ENCONTRADA', 'La cancha no existe en este club');
    }

    return this.e.db.transaction(async (tx) => {
      const cliente = await upsertCliente(tx, cfg.club.id, p.cliente);
      const [repetida] = await tx
        .select({ id: listaEspera.id })
        .from(listaEspera)
        .where(
          and(
            eq(listaEspera.clienteId, cliente.id),
            eq(listaEspera.estado, 'ACTIVA'),
            sql`tstzrange(${listaEspera.desde}, ${listaEspera.hasta}) && tstzrange(${p.desde.toISOString()}::timestamptz, ${p.hasta.toISOString()}::timestamptz)`,
          ),
        );
      if (repetida)
        throw new ErrorNegocio(409, 'YA_EN_LISTA', 'Ya estás anotado en la lista de espera para esa franja');

      const [fila] = await tx
        .insert(listaEspera)
        .values({
          clubId: cfg.club.id,
          clienteId: cliente.id,
          canchaId: p.canchaId ?? null,
          jugadoresPorLado: p.jugadoresPorLado ?? null,
          desde: p.desde,
          hasta: p.hasta,
        })
        .returning({ id: listaEspera.id, estado: listaEspera.estado });
      if (!fila) throw new Error('insert lista_espera sin filas');
      return fila;
    });
  }

  /**
   * Un turno se liberó: se le reserva al primero de la lista que pueda usarlo, con un
   * hold propio y su timer, y se le avisa. Mientras decide, nadie del público lo toma.
   * Se ejecuta dentro de la transacción que liberó el turno.
   */
  async ofrecer(tx: Tx, t: TurnoLiberado): Promise<string | null> {
    const ahora = this.e.reloj();
    if (t.inicio <= ahora) return null;
    const cfg = await this.e.clubs.porId(t.clubId);
    const cancha = cfg?.canchas.find((c) => c.id === t.canchaId);
    if (!cfg || !cancha) return null;
    const cotizacion = cotizarTurno(cfg, cancha, t.inicio);
    if (!cotizacion) return null;

    const conSena = cotizacion.montoSena > 0;
    const expiracion = calcularExpiracion(
      ahora,
      t.inicio,
      conSena ? cotizacion.regla : { ...(cotizacion.regla ?? REGLA_OFERTA_SIN_SENA), requiereSena: true },
      Math.max(cotizacion.montoSena, 1),
    );
    // Si el turno empieza demasiado pronto no hay tiempo de ofrecerlo: queda libre al público.
    if (expiracion.tipo !== 'HOLD') return null;

    const [inscripcion] = await tx
      .select({ id: listaEspera.id, clienteId: listaEspera.clienteId })
      .from(listaEspera)
      .innerJoin(clientes, eq(clientes.id, listaEspera.clienteId))
      .where(
        and(
          eq(listaEspera.clubId, t.clubId),
          eq(listaEspera.estado, 'ACTIVA'),
          lte(listaEspera.desde, t.inicio),
          gte(listaEspera.hasta, t.fin),
          eq(clientes.bloqueado, false),
          t.clienteId ? ne(listaEspera.clienteId, t.clienteId) : undefined,
          sql`(${listaEspera.canchaId} = ${t.canchaId} OR (${listaEspera.canchaId} IS NULL AND (${listaEspera.jugadoresPorLado} IS NULL OR ${listaEspera.jugadoresPorLado} = ${cancha.jugadoresPorLado})))`,
        ),
      )
      .orderBy(listaEspera.creadoEn)
      .limit(1)
      .for('update', { of: listaEspera, skipLocked: true });
    if (!inscripcion) return null;

    let ofertaId: string;
    try {
      ofertaId = await tx.transaction(async (sp) => {
        await setActor(sp, 'worker:lista-espera');
        const [nuevo] = await sp
          .insert(turnos)
          .values({
            clubId: t.clubId,
            canchaId: t.canchaId,
            clienteId: inscripcion.clienteId,
            inicio: t.inicio,
            fin: t.fin,
            estado: 'PRE_RESERVADO',
            origen: 'WEB',
            precioTotal: cotizacion.precio,
            montoSena: cotizacion.montoSena,
            expiraEn: expiracion.expiraEn,
          })
          .returning({ id: turnos.id });
        if (!nuevo) throw new Error('insert de oferta sin filas');
        return nuevo.id;
      });
    } catch (e) {
      if (esTurnoOcupado(e)) return null; // alguien lo reservó en el medio
      throw e;
    }

    await tx
      .update(listaEspera)
      .set({ estado: 'NOTIFICADA', notificadaEn: ahora, ofertaTurnoId: ofertaId })
      .where(eq(listaEspera.id, inscripcion.id));
    await notificarTurno(tx, ofertaId, 'oferta_lista_espera', this.e.urlWeb);
    return ofertaId;
  }

  /** Inscripciones cuya franja ya pasó. */
  async vencerViejas() {
    const filas = await this.e.db
      .update(listaEspera)
      .set({ estado: 'VENCIDA' })
      .where(and(eq(listaEspera.estado, 'ACTIVA'), lte(listaEspera.hasta, this.e.reloj())))
      .returning({ id: listaEspera.id });
    return filas.length;
  }
}
