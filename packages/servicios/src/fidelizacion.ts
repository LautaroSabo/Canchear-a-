import { calcularPuntos, descuentoDePremio, partesLocales } from '@cancheria/core';
import type { Tx } from '@cancheria/db';
import {
  canjes,
  clientes,
  clubs,
  movimientosPuntos,
  premios,
  promocionesPuntos,
  turnos,
} from '@cancheria/db/schema';
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { cuentaDeTurno, saldoDe } from './cuenta.ts';
import type { Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';

export type TipoPremio = 'DESCUENTO_MONTO' | 'DESCUENTO_PORCENTAJE' | 'TURNO_GRATIS' | 'PRODUCTO';

export interface DatosPremio {
  nombre: string;
  descripcion: string | null;
  costoPuntos: number;
  tipo: TipoPremio;
  /** Centavos (monto) o porcentaje. */
  valor: number;
  /** null = ilimitado. */
  stock: number | null;
  activo: boolean;
}

export interface DatosPromocion {
  nombre: string;
  diaSemana: number | null;
  horaDesde: string | null;
  horaHasta: string | null;
  multiplicador: number;
  puntosExtra: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
  activa: boolean;
}

const esDescuento = (t: TipoPremio) => t !== 'PRODUCTO';

/**
 * Suma los puntos de un partido al hacer check-in. Se llama dentro de la transacción del
 * check-in; el índice único de ACUMULACION por turno la hace idempotente.
 */
export async function acumularPuntos(tx: Tx, turnoId: string, ahora: Date): Promise<number> {
  const [t] = await tx
    .select({
      clubId: turnos.clubId,
      clienteId: turnos.clienteId,
      inicio: turnos.inicio,
      zona: clubs.zonaHoraria,
      base: clubs.puntosPorPartido,
    })
    .from(turnos)
    .innerJoin(clubs, eq(clubs.id, turnos.clubId))
    .where(eq(turnos.id, turnoId));
  if (!t?.clienteId || t.base <= 0) return 0;
  const promos = await tx.select().from(promocionesPuntos).where(eq(promocionesPuntos.clubId, t.clubId));
  const local = partesLocales(t.inicio, t.zona);
  const { puntos, promocionId } = calcularPuntos(
    t.base,
    promos.map((p) => ({ ...p, multiplicador: Number(p.multiplicador) })),
    { diaSemana: local.diaSemana, minutoInicio: local.minutos, fecha: local.fecha },
  );
  if (puntos <= 0) return 0;
  const [mov] = await tx
    .insert(movimientosPuntos)
    .values({
      clubId: t.clubId,
      clienteId: t.clienteId,
      tipo: 'ACUMULACION',
      puntos,
      turnoId,
      promocionId,
      creadoEn: ahora,
    })
    .onConflictDoNothing()
    .returning({ id: movimientosPuntos.id });
  if (!mov) return 0;
  await tx
    .update(clientes)
    .set({ saldoPuntos: sql`${clientes.saldoPuntos} + ${puntos}` })
    .where(eq(clientes.id, t.clienteId));
  return puntos;
}

/**
 * Fidelización: puntos por partido (con promociones), premios y canjes. El saldo de cada
 * cliente es una caché de `movimientos_puntos` (ledger append-only) y se actualiza en la
 * misma transacción que cada movimiento, con la fila del cliente bloqueada.
 */
export class ServicioFidelizacion {
  constructor(private readonly e: Entorno) {}

  // --- Configuración ---------------------------------------------------------------

  async configuracion(clubId: string) {
    const [club] = await this.e.db
      .select({ puntosPorPartido: clubs.puntosPorPartido })
      .from(clubs)
      .where(eq(clubs.id, clubId));
    if (!club) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
    const [listaPremios, promos] = await Promise.all([
      this.e.db.select().from(premios).where(eq(premios.clubId, clubId)).orderBy(asc(premios.costoPuntos)),
      this.e.db
        .select()
        .from(promocionesPuntos)
        .where(eq(promocionesPuntos.clubId, clubId))
        .orderBy(asc(promocionesPuntos.diaSemana), asc(promocionesPuntos.horaDesde)),
    ]);
    const corta = (h: string | null) => h?.slice(0, 5) ?? null;
    return {
      puntosPorPartido: club.puntosPorPartido,
      premios: listaPremios.map(({ clubId: _c, ...p }) => p),
      promociones: promos.map(({ clubId: _c, ...p }) => ({
        ...p,
        multiplicador: Number(p.multiplicador),
        horaDesde: corta(p.horaDesde),
        horaHasta: corta(p.horaHasta),
      })),
    };
  }

  async setPuntosPorPartido(clubId: string, puntos: number) {
    await this.e.db.update(clubs).set({ puntosPorPartido: puntos }).where(eq(clubs.id, clubId));
  }

  private validarPremio(p: { tipo?: TipoPremio | undefined; valor?: number | undefined }) {
    if (p.tipo === 'DESCUENTO_PORCENTAJE' && (p.valor === undefined || p.valor < 1 || p.valor > 100)) {
      throw new ErrorNegocio(422, 'PORCENTAJE_INVALIDO', 'El descuento va de 1 a 100 %');
    }
    if (p.tipo === 'DESCUENTO_MONTO' && (p.valor === undefined || p.valor <= 0)) {
      throw new ErrorNegocio(422, 'MONTO_INVALIDO', 'Indicá el monto del descuento');
    }
  }

  async crearPremio(clubId: string, d: DatosPremio) {
    this.validarPremio(d);
    const [p] = await this.e.db
      .insert(premios)
      .values({ clubId, ...d, valor: d.tipo === 'TURNO_GRATIS' || d.tipo === 'PRODUCTO' ? 0 : d.valor })
      .returning();
    return p;
  }

  async actualizarPremio(clubId: string, premioId: string, d: DatosPremio) {
    this.validarPremio(d);
    const filas = await this.e.db
      .update(premios)
      .set({ ...d, valor: d.tipo === 'TURNO_GRATIS' || d.tipo === 'PRODUCTO' ? 0 : d.valor })
      .where(and(eq(premios.id, premioId), eq(premios.clubId, clubId)))
      .returning({ id: premios.id });
    if (filas.length === 0) throw new ErrorNegocio(404, 'PREMIO_NO_ENCONTRADO', 'No existe ese premio');
  }

  private validarPromo(p: DatosPromocion) {
    if ((p.horaDesde === null) !== (p.horaHasta === null)) {
      throw new ErrorNegocio(422, 'FRANJA_INCOMPLETA', 'Indicá las dos horas de la franja, o ninguna');
    }
    if (p.vigenteHasta !== null && p.vigenteHasta < p.vigenteDesde) {
      throw new ErrorNegocio(422, 'VIGENCIA_INVALIDA', 'La fecha de fin es anterior a la de inicio');
    }
  }

  async crearPromocion(clubId: string, d: DatosPromocion) {
    this.validarPromo(d);
    const [p] = await this.e.db
      .insert(promocionesPuntos)
      .values({ clubId, ...d, multiplicador: String(d.multiplicador) })
      .returning({ id: promocionesPuntos.id });
    return p;
  }

  async actualizarPromocion(clubId: string, promocionId: string, d: DatosPromocion) {
    this.validarPromo(d);
    const filas = await this.e.db
      .update(promocionesPuntos)
      .set({ ...d, multiplicador: String(d.multiplicador) })
      .where(and(eq(promocionesPuntos.id, promocionId), eq(promocionesPuntos.clubId, clubId)))
      .returning({ id: promocionesPuntos.id });
    if (filas.length === 0) throw new ErrorNegocio(404, 'PROMOCION_NO_ENCONTRADA', 'No existe esa promoción');
  }

  async borrarPromocion(clubId: string, promocionId: string) {
    // Los movimientos que la usaron quedan, sin la referencia.
    await this.e.db.transaction(async (tx) => {
      await tx
        .update(movimientosPuntos)
        .set({ promocionId: null })
        .where(and(eq(movimientosPuntos.promocionId, promocionId), eq(movimientosPuntos.clubId, clubId)));
      const filas = await tx
        .delete(promocionesPuntos)
        .where(and(eq(promocionesPuntos.id, promocionId), eq(promocionesPuntos.clubId, clubId)))
        .returning({ id: promocionesPuntos.id });
      if (filas.length === 0)
        throw new ErrorNegocio(404, 'PROMOCION_NO_ENCONTRADA', 'No existe esa promoción');
    });
  }

  // --- Clientes ----------------------------------------------------------------------

  /** Búsqueda por nombre (parcial, sin acentos de más) o por teléfono (últimos dígitos). */
  async buscarClientes(clubId: string, q: string) {
    const texto = q.trim();
    const digitos = texto.replace(/\D/g, '');
    return this.e.db
      .select({
        id: clientes.id,
        nombre: clientes.nombre,
        telefono: clientes.telefonoE164,
        saldoPuntos: clientes.saldoPuntos,
        bloqueado: clientes.bloqueado,
        partidos: sql<number>`(SELECT count(*)::int FROM turnos t WHERE t.cliente_id = clientes.id AND t.estado = 'PRESENTE')`,
      })
      .from(clientes)
      .where(
        and(
          eq(clientes.clubId, clubId),
          or(
            ilike(clientes.nombre, `%${texto.replace(/[%_\\]/g, '\\$&')}%`),
            digitos.length >= 4 ? sql`${clientes.telefonoE164} LIKE ${`%${digitos}`}` : undefined,
          ),
        ),
      )
      .orderBy(desc(clientes.saldoPuntos), asc(clientes.nombre))
      .limit(20);
  }

  async cliente(clubId: string, clienteId: string) {
    const [c] = await this.e.db
      .select({
        id: clientes.id,
        nombre: clientes.nombre,
        telefono: clientes.telefonoE164,
        dni: clientes.dni,
        saldoPuntos: clientes.saldoPuntos,
        bloqueado: clientes.bloqueado,
        creadoEn: clientes.creadoEn,
      })
      .from(clientes)
      .where(and(eq(clientes.id, clienteId), eq(clientes.clubId, clubId)));
    if (!c) throw new ErrorNegocio(404, 'CLIENTE_NO_ENCONTRADO', 'No existe ese cliente');
    const ahora = this.e.reloj();
    const [movs, listaCanjes, proximos, [estadisticas]] = await Promise.all([
      this.e.db
        .select({
          id: movimientosPuntos.id,
          tipo: movimientosPuntos.tipo,
          puntos: movimientosPuntos.puntos,
          motivo: movimientosPuntos.motivo,
          creadoEn: movimientosPuntos.creadoEn,
          turnoInicio: turnos.inicio,
          promocion: promocionesPuntos.nombre,
          premio: premios.nombre,
        })
        .from(movimientosPuntos)
        .leftJoin(turnos, eq(turnos.id, movimientosPuntos.turnoId))
        .leftJoin(promocionesPuntos, eq(promocionesPuntos.id, movimientosPuntos.promocionId))
        .leftJoin(canjes, eq(canjes.id, movimientosPuntos.canjeId))
        .leftJoin(premios, eq(premios.id, canjes.premioId))
        .where(eq(movimientosPuntos.clienteId, clienteId))
        .orderBy(desc(movimientosPuntos.creadoEn))
        .limit(50),
      this.canjesDe(and(eq(canjes.clienteId, clienteId), eq(canjes.clubId, clubId))),
      this.e.db
        .select({
          id: turnos.id,
          inicio: turnos.inicio,
          estado: turnos.estado,
          precioTotal: turnos.precioTotal,
        })
        .from(turnos)
        .where(
          and(
            eq(turnos.clienteId, clienteId),
            inArray(turnos.estado, ['CONFIRMADO', 'PRESENTE']),
            gt(turnos.fin, ahora),
          ),
        )
        .orderBy(asc(turnos.inicio))
        .limit(10),
      this.e.db
        .select({
          partidos: sql<number>`count(*) FILTER (WHERE ${turnos.estado} = 'PRESENTE')::int`,
          ausencias: sql<number>`count(*) FILTER (WHERE ${turnos.estado} = 'AUSENTE')::int`,
          cancelados: sql<number>`count(*) FILTER (WHERE ${turnos.estado} = 'CANCELADO')::int`,
          ultimo: sql<string | null>`max(${turnos.inicio}) FILTER (WHERE ${turnos.estado} = 'PRESENTE')`,
        })
        .from(turnos)
        .where(eq(turnos.clienteId, clienteId)),
    ]);
    return {
      ...c,
      ...(estadisticas ?? { partidos: 0, ausencias: 0, cancelados: 0, ultimo: null }),
      movimientos: movs,
      canjes: listaCanjes,
      proximosTurnos: proximos,
    };
  }

  private canjesDe(condicion: ReturnType<typeof and>) {
    return this.e.db
      .select({
        id: canjes.id,
        codigo: canjes.codigo,
        estado: canjes.estado,
        puntos: canjes.puntos,
        montoAplicado: canjes.montoAplicado,
        turnoId: canjes.turnoId,
        creadoEn: canjes.creadoEn,
        usadoEn: canjes.usadoEn,
        premio: { id: premios.id, nombre: premios.nombre, tipo: premios.tipo, valor: premios.valor },
      })
      .from(canjes)
      .innerJoin(premios, eq(premios.id, canjes.premioId))
      .where(condicion)
      .orderBy(desc(canjes.creadoEn));
  }

  /** Canjes aplicados a un turno y los de descuento que el cliente tiene sin usar. */
  async paraTurno(clubId: string, turnoId: string) {
    const [t] = await this.e.db
      .select({ clienteId: turnos.clienteId, saldoPuntos: clientes.saldoPuntos })
      .from(turnos)
      .leftJoin(clientes, eq(clientes.id, turnos.clienteId))
      .where(and(eq(turnos.id, turnoId), eq(turnos.clubId, clubId)));
    if (!t?.clienteId) return { saldoPuntos: 0, aplicados: [], disponibles: [] };
    const [aplicados, disponibles] = await Promise.all([
      this.canjesDe(and(eq(canjes.turnoId, turnoId), eq(canjes.estado, 'USADO'))),
      this.canjesDe(
        and(
          eq(canjes.clienteId, t.clienteId),
          eq(canjes.estado, 'EMITIDO'),
          inArray(premios.tipo, ['DESCUENTO_MONTO', 'DESCUENTO_PORCENTAJE', 'TURNO_GRATIS']),
        ),
      ),
    ]);
    return { saldoPuntos: t.saldoPuntos ?? 0, aplicados, disponibles };
  }

  // --- Canjes ------------------------------------------------------------------------

  private async bloquearCliente(tx: Tx, clubId: string, clienteId: string) {
    const [c] = await tx
      .select()
      .from(clientes)
      .where(and(eq(clientes.id, clienteId), eq(clientes.clubId, clubId)))
      .for('update');
    if (!c) throw new ErrorNegocio(404, 'CLIENTE_NO_ENCONTRADO', 'No existe ese cliente');
    return c;
  }

  /**
   * Canjea un premio. Los de producto se entregan en el momento (USADO). Los de
   * descuento quedan EMITIDOS para usar en un turno, o se aplican directo si viene
   * `turnoId`.
   */
  async canjear(
    clubId: string,
    usuarioId: string,
    p: { clienteId: string; premioId: string; turnoId?: string | undefined },
  ) {
    return this.e.db.transaction(async (tx) => {
      const cliente = await this.bloquearCliente(tx, clubId, p.clienteId);
      const [premio] = await tx
        .select()
        .from(premios)
        .where(and(eq(premios.id, p.premioId), eq(premios.clubId, clubId)))
        .for('update');
      if (!premio?.activo)
        throw new ErrorNegocio(404, 'PREMIO_NO_ENCONTRADO', 'Ese premio no existe o no está disponible');
      if (premio.stock !== null && premio.stock <= 0) {
        throw new ErrorNegocio(409, 'PREMIO_AGOTADO', `No quedan ${premio.nombre}`);
      }
      if (cliente.saldoPuntos < premio.costoPuntos) {
        throw new ErrorNegocio(
          409,
          'PUNTOS_INSUFICIENTES',
          `${cliente.nombre} tiene ${cliente.saldoPuntos} puntos y el premio cuesta ${premio.costoPuntos}`,
        );
      }
      if (p.turnoId && !esDescuento(premio.tipo)) {
        throw new ErrorNegocio(
          422,
          'PREMIO_SIN_TURNO',
          'Ese premio se entrega en el mostrador, no se aplica a un turno',
        );
      }
      const ahora = this.e.reloj();
      const [canje] = await tx
        .insert(canjes)
        .values({
          clubId,
          clienteId: cliente.id,
          premioId: premio.id,
          puntos: premio.costoPuntos,
          estado: esDescuento(premio.tipo) ? 'EMITIDO' : 'USADO',
          usadoEn: esDescuento(premio.tipo) ? null : ahora,
          creadoPor: usuarioId,
          creadoEn: ahora,
        })
        .returning();
      if (!canje) throw new Error('insert de canje sin filas');
      await tx.insert(movimientosPuntos).values({
        clubId,
        clienteId: cliente.id,
        tipo: 'CANJE',
        puntos: -premio.costoPuntos,
        canjeId: canje.id,
        usuarioId,
        creadoEn: ahora,
      });
      await tx
        .update(clientes)
        .set({ saldoPuntos: cliente.saldoPuntos - premio.costoPuntos })
        .where(eq(clientes.id, cliente.id));
      if (premio.stock !== null) {
        await tx
          .update(premios)
          .set({ stock: premio.stock - 1 })
          .where(eq(premios.id, premio.id));
      }
      const aplicado = p.turnoId ? await this.aplicarEn(tx, canje.id, cliente.id, premio, p.turnoId) : 0;
      return {
        id: canje.id,
        codigo: canje.codigo,
        estado: p.turnoId ? ('USADO' as const) : canje.estado,
        montoAplicado: aplicado,
        saldoPuntos: cliente.saldoPuntos - premio.costoPuntos,
      };
    });
  }

  /** Aplica un canje de descuento emitido a un turno del mismo cliente. */
  async aplicar(clubId: string, canjeId: string, turnoId: string) {
    return this.e.db.transaction(async (tx) => {
      const [c] = await tx
        .select({ canje: canjes, premio: premios })
        .from(canjes)
        .innerJoin(premios, eq(premios.id, canjes.premioId))
        .where(and(eq(canjes.id, canjeId), eq(canjes.clubId, clubId)))
        .for('update', { of: canjes });
      if (!c) throw new ErrorNegocio(404, 'CANJE_NO_ENCONTRADO', 'No existe ese canje');
      if (c.canje.estado !== 'EMITIDO')
        throw new ErrorNegocio(409, 'CANJE_USADO', `Ese canje está ${c.canje.estado.toLowerCase()}`);
      if (!esDescuento(c.premio.tipo)) {
        throw new ErrorNegocio(
          422,
          'PREMIO_SIN_TURNO',
          'Ese premio se entrega en el mostrador, no se aplica a un turno',
        );
      }
      return { montoAplicado: await this.aplicarEn(tx, canjeId, c.canje.clienteId, c.premio, turnoId) };
    });
  }

  private async aplicarEn(
    tx: Tx,
    canjeId: string,
    clienteId: string,
    premio: { tipo: TipoPremio; valor: number },
    turnoId: string,
  ) {
    const [t] = await tx
      .select({ clienteId: turnos.clienteId, estado: turnos.estado })
      .from(turnos)
      .where(eq(turnos.id, turnoId))
      .for('update');
    if (!t || t.clienteId !== clienteId) {
      throw new ErrorNegocio(
        422,
        'TURNO_DE_OTRO_CLIENTE',
        'El canje solo se puede usar en un turno de quien lo canjeó',
      );
    }
    if (t.estado !== 'CONFIRMADO' && t.estado !== 'PRESENTE') {
      throw new ErrorNegocio(409, 'TURNO_SIN_CUENTA', 'Solo se aplica a un turno confirmado o en cancha');
    }
    const cuenta = await cuentaDeTurno(tx, turnoId);
    if (!cuenta) throw new Error('turno desapareció');
    // El descuento es sobre el precio del turno (no la cantina) y nunca deja saldo a favor.
    const monto = Math.min(
      descuentoDePremio(premio, cuenta.precioTotal),
      cuenta.precioTotal - cuenta.descuentos,
      saldoDe(cuenta),
    );
    if (monto <= 0)
      throw new ErrorNegocio(
        409,
        'TURNO_PAGADO',
        'Ese turno ya está pagado o descontado: no hay nada que descontar',
      );
    await tx
      .update(canjes)
      .set({ estado: 'USADO', turnoId, montoAplicado: monto, usadoEn: this.e.reloj() })
      .where(eq(canjes.id, canjeId));
    return monto;
  }

  /** Anula un canje: devuelve los puntos, el stock del premio y, si estaba aplicado, el descuento. */
  async anularCanje(clubId: string, usuarioId: string, canjeId: string, motivo: string) {
    return this.e.db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(canjes)
        .where(and(eq(canjes.id, canjeId), eq(canjes.clubId, clubId)))
        .for('update');
      if (!c) throw new ErrorNegocio(404, 'CANJE_NO_ENCONTRADO', 'No existe ese canje');
      if (c.estado === 'ANULADO') throw new ErrorNegocio(409, 'CANJE_ANULADO', 'Ese canje ya está anulado');
      const cliente = await this.bloquearCliente(tx, clubId, c.clienteId);
      const ahora = this.e.reloj();
      await tx
        .update(canjes)
        .set({
          estado: 'ANULADO',
          anuladoEn: ahora,
          motivoAnulacion: motivo,
          montoAplicado: 0,
          turnoId: null,
        })
        .where(eq(canjes.id, canjeId));
      await tx.insert(movimientosPuntos).values({
        clubId,
        clienteId: c.clienteId,
        tipo: 'REVERSION',
        puntos: c.puntos,
        canjeId,
        usuarioId,
        motivo,
        creadoEn: ahora,
      });
      await tx
        .update(clientes)
        .set({ saldoPuntos: cliente.saldoPuntos + c.puntos })
        .where(eq(clientes.id, c.clienteId));
      await tx
        .update(premios)
        .set({ stock: sql`${premios.stock} + 1` })
        .where(and(eq(premios.id, c.premioId), isNotNull(premios.stock)));
      return { saldoPuntos: cliente.saldoPuntos + c.puntos };
    });
  }

  /** Ajuste manual (regalo, corrección). Nunca deja el saldo negativo. */
  async ajustar(clubId: string, usuarioId: string, clienteId: string, puntos: number, motivo: string) {
    if (puntos === 0) throw new ErrorNegocio(422, 'AJUSTE_VACIO', 'Indicá cuántos puntos sumar o restar');
    return this.e.db.transaction(async (tx) => {
      const c = await this.bloquearCliente(tx, clubId, clienteId);
      if (c.saldoPuntos + puntos < 0) {
        throw new ErrorNegocio(409, 'PUNTOS_INSUFICIENTES', `${c.nombre} tiene ${c.saldoPuntos} puntos`);
      }
      await tx.insert(movimientosPuntos).values({
        clubId,
        clienteId,
        tipo: 'AJUSTE',
        puntos,
        usuarioId,
        motivo,
        creadoEn: this.e.reloj(),
      });
      await tx
        .update(clientes)
        .set({ saldoPuntos: c.saldoPuntos + puntos })
        .where(eq(clientes.id, clienteId));
      return { saldoPuntos: c.saldoPuntos + puntos };
    });
  }
}
