import { instanteLocal, partesLocales, sumarDias } from '@cancheria/core';
import { type Tx, violaUnique } from '@cancheria/db';
import {
  type CategoriaProducto,
  consumos,
  inventarioCantina,
  movimientosStock,
  pagos,
  reembolsos,
  turnos,
  ventasCantina,
} from '@cancheria/db/schema';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { RepoClubs } from './config-club.ts';
import type { Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';
import { pesos } from './formato.ts';

export type MedioCantina = 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO' | 'OTRO';

/**
 * Lo consumido en la cantina a cuenta del turno (ventas no anuladas): suma al saldo.
 * `turnos.id` va calificado a mano: en un SELECT de una sola tabla Drizzle escribe solo
 * "id", que dentro de la subconsulta sería el id de la venta.
 */
export const consumosDeTurnoSql = sql<string>`(
  SELECT coalesce(sum(v.total), 0) FROM ventas_cantina v
   WHERE v.turno_id = turnos.id AND v.anulada_en IS NULL)`;

/** Pagos aprobados de un turno que no se devolvieron. */
const pagadoDeTurno = (turnoId: string) => sql<string>`(
  SELECT coalesce(sum(p.monto), 0) FROM ${pagos} p
   WHERE p.turno_id = ${turnoId} AND p.estado = 'APROBADO'
     AND NOT EXISTS (SELECT 1 FROM ${reembolsos} r WHERE r.pago_id = p.id))`;

export interface DatosProducto {
  nombre: string;
  categoria: CategoriaProducto;
  /** Centavos. */
  precio: number;
  controlaStock: boolean;
  stockMinimo: number;
  activo: boolean;
}

export interface PedidoVenta {
  items: { productoId: string; cantidad: number }[];
  /** A la cuenta del turno (se cobra con el saldo) o… */
  turnoId?: string | undefined;
  /** …cobrada en el momento. */
  medio?: MedioCantina | undefined;
  idempotencyKey?: string | undefined;
}

/**
 * Cantina: productos con stock, ventas de mostrador o a la cuenta de un turno, y un
 * libro de movimientos para auditar el stock. El stock se descuenta con un UPDATE
 * condicional (`stock >= cantidad`): dos ventas simultáneas del último producto no
 * pueden dejarlo negativo.
 */
export class ServicioCantina {
  constructor(private readonly e: Entorno & { clubs: RepoClubs }) {}

  // --- Productos ----------------------------------------------------------------

  async productos(clubId: string, { incluirInactivos = false } = {}) {
    return this.e.db
      .select()
      .from(inventarioCantina)
      .where(
        and(
          eq(inventarioCantina.clubId, clubId),
          incluirInactivos ? undefined : eq(inventarioCantina.activo, true),
        ),
      )
      .orderBy(asc(inventarioCantina.categoria), asc(inventarioCantina.nombre));
  }

  async crearProducto(clubId: string, usuarioId: string, d: DatosProducto & { stockInicial: number }) {
    try {
      return await this.e.db.transaction(async (tx) => {
        const { stockInicial, ...datos } = d;
        const stock = d.controlaStock ? stockInicial : 0;
        const [p] = await tx
          .insert(inventarioCantina)
          .values({ clubId, ...datos, stock })
          .returning();
        if (!p) throw new Error('insert de producto sin filas');
        if (stock > 0) {
          await tx.insert(movimientosStock).values({
            clubId,
            productoId: p.id,
            tipo: 'AJUSTE',
            cantidad: stock,
            stockResultante: stock,
            usuarioId,
            motivo: 'Stock inicial',
          });
        }
        return p;
      });
    } catch (err) {
      throw nombreRepetido(err);
    }
  }

  /** Datos del producto; el stock solo cambia por reposición, ajuste o ventas. */
  async actualizarProducto(
    clubId: string,
    productoId: string,
    d: { [K in keyof DatosProducto]?: DatosProducto[K] | undefined },
  ) {
    if (Object.values(d).every((v) => v === undefined)) return;
    try {
      const filas = await this.e.db
        .update(inventarioCantina)
        .set(d)
        .where(and(eq(inventarioCantina.id, productoId), eq(inventarioCantina.clubId, clubId)))
        .returning({ id: inventarioCantina.id });
      if (filas.length === 0) throw new ErrorNegocio(404, 'PRODUCTO_NO_ENCONTRADO', 'No existe ese producto');
    } catch (err) {
      throw nombreRepetido(err);
    }
  }

  /** Llegó mercadería: suma `cantidad` al stock. */
  async reponer(clubId: string, usuarioId: string, productoId: string, cantidad: number, motivo?: string) {
    return this.moverStock(
      clubId,
      usuarioId,
      productoId,
      'REPOSICION',
      motivo ?? null,
      (actual) => actual + cantidad,
    );
  }

  /** Conteo físico: el stock pasa a ser `contado`; la diferencia queda en el libro. */
  async ajustar(clubId: string, usuarioId: string, productoId: string, contado: number, motivo: string) {
    return this.moverStock(clubId, usuarioId, productoId, 'AJUSTE', motivo, () => contado);
  }

  private async moverStock(
    clubId: string,
    usuarioId: string,
    productoId: string,
    tipo: 'REPOSICION' | 'AJUSTE',
    motivo: string | null,
    nuevo: (actual: number) => number,
  ) {
    return this.e.db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(inventarioCantina)
        .where(and(eq(inventarioCantina.id, productoId), eq(inventarioCantina.clubId, clubId)))
        .for('update');
      if (!p) throw new ErrorNegocio(404, 'PRODUCTO_NO_ENCONTRADO', 'No existe ese producto');
      if (!p.controlaStock) throw new ErrorNegocio(409, 'SIN_CONTROL_DE_STOCK', `${p.nombre} no lleva stock`);
      const stock = nuevo(p.stock);
      if (stock === p.stock) return { stock };
      await tx.update(inventarioCantina).set({ stock }).where(eq(inventarioCantina.id, productoId));
      await tx.insert(movimientosStock).values({
        clubId,
        productoId,
        tipo,
        cantidad: stock - p.stock,
        stockResultante: stock,
        usuarioId,
        motivo,
      });
      return { stock };
    });
  }

  async movimientos(clubId: string, productoId: string, limite = 50) {
    return this.e.db
      .select()
      .from(movimientosStock)
      .where(and(eq(movimientosStock.clubId, clubId), eq(movimientosStock.productoId, productoId)))
      .orderBy(desc(movimientosStock.id))
      .limit(limite);
  }

  // --- Ventas -------------------------------------------------------------------

  async vender(clubId: string, usuarioId: string, p: PedidoVenta) {
    if ((p.turnoId === undefined) === (p.medio === undefined)) {
      throw new ErrorNegocio(
        422,
        'DESTINO_INVALIDO',
        'Indicá si se cobra ahora (medio) o se carga a un turno',
      );
    }
    // Un renglón por producto, y en orden fijo: dos ventas que tocan los mismos
    // productos los bloquean en el mismo orden y no se trancan entre sí.
    const items = [
      ...p.items.reduce(
        (m, i) => m.set(i.productoId, (m.get(i.productoId) ?? 0) + i.cantidad),
        new Map<string, number>(),
      ),
    ]
      .map(([productoId, cantidad]) => ({ productoId, cantidad }))
      .sort((a, b) => (a.productoId < b.productoId ? -1 : 1));
    if (items.length === 0) throw new ErrorNegocio(422, 'VENTA_VACIA', 'Agregá al menos un producto');

    try {
      return await this.e.db.transaction(async (tx) => {
        if (p.turnoId) await this.turnoConCuenta(tx, clubId, p.turnoId);
        const [venta] = await tx
          .insert(ventasCantina)
          .values({
            clubId,
            turnoId: p.turnoId ?? null,
            medio: p.medio ?? null,
            total: 0,
            idempotencyKey: p.idempotencyKey ?? null,
            creadoPor: usuarioId,
            creadoEn: this.e.reloj(),
          })
          .returning();
        if (!venta) throw new Error('insert de venta sin filas');

        let total = 0;
        const renglones = [];
        for (const it of items) {
          const [prod] = await tx
            .update(inventarioCantina)
            .set({
              stock: sql`CASE WHEN ${inventarioCantina.controlaStock} THEN ${inventarioCantina.stock} - ${it.cantidad} ELSE ${inventarioCantina.stock} END`,
            })
            .where(
              and(
                eq(inventarioCantina.id, it.productoId),
                eq(inventarioCantina.clubId, clubId),
                eq(inventarioCantina.activo, true),
                sql`(NOT ${inventarioCantina.controlaStock} OR ${inventarioCantina.stock} >= ${it.cantidad})`,
              ),
            )
            .returning();
          if (!prod) return await this.sinStock(tx, clubId, it.productoId, it.cantidad);
          await tx.insert(consumos).values({
            clubId,
            ventaId: venta.id,
            productoId: prod.id,
            cantidad: it.cantidad,
            precioUnitario: prod.precio,
            cargadoPor: usuarioId,
          });
          await tx.insert(movimientosStock).values({
            clubId,
            productoId: prod.id,
            tipo: 'VENTA',
            cantidad: -it.cantidad,
            stockResultante: prod.controlaStock ? prod.stock : null,
            ventaId: venta.id,
            usuarioId,
          });
          total += prod.precio * it.cantidad;
          renglones.push({
            productoId: prod.id,
            nombre: prod.nombre,
            cantidad: it.cantidad,
            precioUnitario: prod.precio,
          });
        }
        await tx.update(ventasCantina).set({ total }).where(eq(ventasCantina.id, venta.id));
        return { ...venta, total, items: renglones };
      });
    } catch (err) {
      // Doble toque en "Cobrar": devolvemos la venta que ya se hizo.
      if (p.idempotencyKey && violaUnique(err, 'ventas_idempotency_uq')) {
        const [previa] = await this.ventas(clubId, { idempotencyKey: p.idempotencyKey });
        if (previa) return previa;
      }
      throw err;
    }
  }

  private async sinStock(tx: Tx, clubId: string, productoId: string, pedido: number): Promise<never> {
    const [p] = await tx
      .select()
      .from(inventarioCantina)
      .where(and(eq(inventarioCantina.id, productoId), eq(inventarioCantina.clubId, clubId)));
    if (!p?.activo)
      throw new ErrorNegocio(404, 'PRODUCTO_NO_ENCONTRADO', 'Ese producto no existe o está dado de baja');
    throw new ErrorNegocio(
      409,
      'SIN_STOCK',
      p.stock === 0 ? `No queda ${p.nombre}` : `Quedan ${p.stock} de ${p.nombre} y pediste ${pedido}`,
      { productoId, disponible: p.stock },
    );
  }

  /** Solo se carga a turnos con cliente que están por jugarse o jugándose. */
  private async turnoConCuenta(tx: Tx, clubId: string, turnoId: string) {
    const [t] = await tx
      .select({ id: turnos.id, estado: turnos.estado, origen: turnos.origen })
      .from(turnos)
      .where(and(eq(turnos.id, turnoId), eq(turnos.clubId, clubId)))
      .for('update');
    if (!t) throw new ErrorNegocio(404, 'TURNO_NO_ENCONTRADO', 'No existe ese turno');
    if (t.origen === 'BLOQUEO' || (t.estado !== 'CONFIRMADO' && t.estado !== 'PRESENTE')) {
      throw new ErrorNegocio(
        409,
        'TURNO_SIN_CUENTA',
        'Solo se puede cargar a un turno confirmado o en cancha',
      );
    }
    return t;
  }

  /**
   * Anula una venta y devuelve el stock. Si estaba a cuenta de un turno que ya se cobró
   * de más con esa anulación, no se deja: primero hay que resolver la devolución.
   */
  async anular(clubId: string, usuarioId: string, ventaId: string, motivo: string) {
    return this.e.db.transaction(async (tx) => {
      const [v] = await tx
        .select()
        .from(ventasCantina)
        .where(and(eq(ventasCantina.id, ventaId), eq(ventasCantina.clubId, clubId)))
        .for('update');
      if (!v) throw new ErrorNegocio(404, 'VENTA_NO_ENCONTRADA', 'No existe esa venta');
      if (v.anuladaEn) throw new ErrorNegocio(409, 'VENTA_ANULADA', 'Esa venta ya está anulada');
      if (v.turnoId) {
        const [t] = await tx
          .select({
            precio: turnos.precioTotal,
            consumos: consumosDeTurnoSql,
            pagado: pagadoDeTurno(v.turnoId),
          })
          .from(turnos)
          .where(eq(turnos.id, v.turnoId))
          .for('update');
        if (t && Number(t.pagado) > t.precio + Number(t.consumos) - v.total) {
          throw new ErrorNegocio(
            409,
            'VENTA_COBRADA',
            `Esa cuenta ya se cobró: si anulás, sobran ${pesos(Number(t.pagado) - (t.precio + Number(t.consumos) - v.total))} que habría que devolver`,
          );
        }
      }
      await tx
        .update(ventasCantina)
        .set({ anuladaEn: this.e.reloj(), anuladaPor: usuarioId, motivoAnulacion: motivo })
        .where(eq(ventasCantina.id, ventaId));
      const renglones = await tx
        .select()
        .from(consumos)
        .where(eq(consumos.ventaId, ventaId))
        .orderBy(asc(consumos.productoId));
      for (const r of renglones) {
        const [prod] = await tx
          .update(inventarioCantina)
          .set({
            stock: sql`CASE WHEN ${inventarioCantina.controlaStock} THEN ${inventarioCantina.stock} + ${r.cantidad} ELSE ${inventarioCantina.stock} END`,
          })
          .where(eq(inventarioCantina.id, r.productoId))
          .returning();
        await tx.insert(movimientosStock).values({
          clubId,
          productoId: r.productoId,
          tipo: 'ANULACION',
          cantidad: r.cantidad,
          stockResultante: prod?.controlaStock ? prod.stock : null,
          ventaId,
          usuarioId,
          motivo,
        });
      }
    });
  }

  /** Ventas con sus renglones: de un día (hora del club), de un turno o por clave de idempotencia. */
  async ventas(clubId: string, f: { fecha?: string; turnoId?: string; idempotencyKey?: string }) {
    let rango: [Date, Date] | null = null;
    if (f.fecha) {
      const cfg = await this.e.clubs.porId(clubId);
      const zona = cfg?.club.zonaHoraria ?? 'UTC';
      rango = [instanteLocal(f.fecha, '00:00', zona), instanteLocal(sumarDias(f.fecha, 1), '00:00', zona)];
    }
    const lista = await this.e.db
      .select()
      .from(ventasCantina)
      .where(
        and(
          eq(ventasCantina.clubId, clubId),
          rango
            ? and(gte(ventasCantina.creadoEn, rango[0]), lt(ventasCantina.creadoEn, rango[1]))
            : undefined,
          f.turnoId ? eq(ventasCantina.turnoId, f.turnoId) : undefined,
          f.idempotencyKey ? eq(ventasCantina.idempotencyKey, f.idempotencyKey) : undefined,
        ),
      )
      .orderBy(desc(ventasCantina.creadoEn));
    if (lista.length === 0) return [];
    const renglones = await this.e.db
      .select({
        ventaId: consumos.ventaId,
        productoId: consumos.productoId,
        nombre: inventarioCantina.nombre,
        cantidad: consumos.cantidad,
        precioUnitario: consumos.precioUnitario,
      })
      .from(consumos)
      .innerJoin(inventarioCantina, eq(inventarioCantina.id, consumos.productoId))
      .where(
        inArray(
          consumos.ventaId,
          lista.map((v) => v.id),
        ),
      )
      .orderBy(asc(inventarioCantina.nombre));
    return lista.map((v) => ({
      ...v,
      items: renglones.filter((r) => r.ventaId === v.id).map(({ ventaId: _v, ...r }) => r),
    }));
  }

  /** Caja de la cantina de un día: cobrado por medio, cargado a turnos, más vendidos, stock bajo. */
  async resumenDia(clubId: string, fecha?: string) {
    const cfg = await this.e.clubs.porId(clubId);
    const zona = cfg?.club.zonaHoraria ?? 'UTC';
    const dia = fecha ?? partesLocales(this.e.reloj(), zona).fecha;
    const ventas = await this.ventas(clubId, { fecha: dia });
    const vigentes = ventas.filter((v) => !v.anuladaEn);
    const porMedio: Record<string, number> = {};
    for (const v of vigentes) if (v.medio) porMedio[v.medio] = (porMedio[v.medio] ?? 0) + v.total;
    const masVendidos = new Map<string, { nombre: string; cantidad: number; total: number }>();
    for (const v of vigentes) {
      for (const r of v.items) {
        const m = masVendidos.get(r.productoId) ?? { nombre: r.nombre, cantidad: 0, total: 0 };
        m.cantidad += r.cantidad;
        m.total += r.cantidad * r.precioUnitario;
        masVendidos.set(r.productoId, m);
      }
    }
    const bajos = await this.e.db
      .select({
        id: inventarioCantina.id,
        nombre: inventarioCantina.nombre,
        stock: inventarioCantina.stock,
        stockMinimo: inventarioCantina.stockMinimo,
      })
      .from(inventarioCantina)
      .where(
        and(
          eq(inventarioCantina.clubId, clubId),
          eq(inventarioCantina.activo, true),
          eq(inventarioCantina.controlaStock, true),
          sql`${inventarioCantina.stock} <= ${inventarioCantina.stockMinimo}`,
        ),
      )
      .orderBy(asc(inventarioCantina.stock));
    return {
      fecha: dia,
      cobradoPorMedio: porMedio,
      cobrado: Object.values(porMedio).reduce((a, b) => a + b, 0),
      aCuentaDeTurnos: vigentes.filter((v) => v.turnoId).reduce((a, v) => a + v.total, 0),
      ventas: vigentes.length,
      anuladas: ventas.length - vigentes.length,
      masVendidos: [...masVendidos.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 5),
      stockBajo: bajos,
    };
  }
}

function nombreRepetido(err: unknown) {
  if (violaUnique(err)) return new ErrorNegocio(409, 'NOMBRE_EN_USO', 'Ya hay un producto con ese nombre');
  return err;
}
