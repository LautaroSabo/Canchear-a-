import { diaSemana, instanteLocal, partesLocales, sumarDias, ventanasDeJornada } from '@cancheria/core';
import {
  canchas,
  canjes,
  clientes,
  consumos,
  inventarioCantina,
  pagos,
  reembolsos,
  turnos,
  ventasCantina,
} from '@cancheria/db/schema';
import { and, asc, type Column, count, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { ConfigClub, RepoClubs } from './config-club.ts';
import { aCuenta, consumosDeTurnoSql, descuentosDeTurnoSql, pagadoDeTurnoSql, saldoDe } from './cuenta.ts';
import type { Entorno } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';

const HORA = 3_600_000;
const MAX_DIAS = 366;
const OCUPAN = ['CONFIRMADO', 'PRESENTE', 'AUSENTE'] as const;

export interface Bloque {
  /** Minutos-cancha abiertos (sin contar bloqueos). */
  disponible: number;
  /** Minutos-cancha con turno. */
  ocupado: number;
}

const solape = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Fechas locales de `desde` a `hasta`, inclusive. */
function fechasEntre(desde: string, hasta: string) {
  const r: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) r.push(d);
  return r;
}

/**
 * Ocupación por bloque de una hora local: lo abierto según los horarios del club (y los
 * feriados) por cada cancha activa, contra lo ocupado por turnos. Los bloqueos restan
 * de lo disponible. Se calcula en memoria: un año de una cancha son ~8.800 bloques.
 */
export function calcularOcupacion(
  cfg: Pick<ConfigClub, 'club' | 'horarios' | 'especiales'>,
  canchaIds: string[],
  fechas: string[],
  ocupaciones: { canchaId: string; inicio: Date; fin: Date; bloqueo: boolean }[],
) {
  const zona = cfg.club.zonaHoraria;
  const especial = (d: string) => cfg.especiales.find((e) => e.fecha === d);
  const indice = new Map(fechas.map((d, i) => [d, i]));
  const bases = fechas.map((d) => instanteLocal(d, '00:00', zona).getTime());
  // abierto[díaIdx][hora] en minutos, igual para todas las canchas.
  const abierto = fechas.map((d, i) => {
    const base = bases[i] ?? 0;
    const ventanas = [sumarDias(d, -1), d].flatMap((x) =>
      ventanasDeJornada(x, zona, cfg.horarios, especial(x)),
    );
    return Array.from({ length: 24 }, (_, h) =>
      ventanas.reduce(
        (a, v) =>
          a + solape(base + h * HORA, base + (h + 1) * HORA, v.inicio.getTime(), v.fin.getTime()) / 60_000,
        0,
      ),
    );
  });
  const porCancha = new Map(canchaIds.map((id) => [id, fechas.map(() => new Array<number>(24).fill(0))]));
  const bloqueado = new Map(canchaIds.map((id) => [id, fechas.map(() => new Array<number>(24).fill(0))]));
  for (const o of ocupaciones) {
    const destino = (o.bloqueo ? bloqueado : porCancha).get(o.canchaId);
    if (!destino) continue;
    let i =
      indice.get(partesLocales(o.inicio, zona).fecha) ?? (o.inicio.getTime() < (bases[0] ?? 0) ? 0 : -1);
    for (; i >= 0 && i < fechas.length; i++) {
      const base = bases[i] ?? 0;
      if (base >= o.fin.getTime()) break;
      const fila = destino[i];
      if (!fila) continue;
      for (let h = 0; h < 24; h++)
        fila[h] =
          (fila[h] ?? 0) +
          solape(base + h * HORA, base + (h + 1) * HORA, o.inicio.getTime(), o.fin.getTime()) / 60_000;
    }
  }
  // Bloques por (fecha, hora) sumando canchas; lo ocupado nunca pasa lo disponible.
  return fechas.map((_, i) =>
    Array.from({ length: 24 }, (_, h): Bloque => {
      let disponible = 0;
      let ocupado = 0;
      for (const id of canchaIds) {
        const libre = Math.max(0, (abierto[i]?.[h] ?? 0) - (bloqueado.get(id)?.[i]?.[h] ?? 0));
        disponible += libre;
        ocupado += Math.min(libre, porCancha.get(id)?.[i]?.[h] ?? 0);
      }
      return { disponible, ocupado };
    }),
  );
}

/** Reportes del club para un período (fechas locales, inclusive). Solo lectura. */
export class ServicioReportes {
  constructor(private readonly e: Entorno & { clubs: RepoClubs }) {}

  private async rango(clubId: string, desde: string, hasta: string) {
    if (hasta < desde)
      throw new ErrorNegocio(422, 'RANGO_INVALIDO', 'La fecha de fin es anterior a la de inicio');
    const fechas = fechasEntre(desde, hasta);
    if (fechas.length > MAX_DIAS)
      throw new ErrorNegocio(422, 'RANGO_MUY_LARGO', 'El período puede ser de hasta un año');
    const cfg = await this.e.clubs.porId(clubId);
    if (!cfg) throw new ErrorNegocio(404, 'CLUB_NO_ENCONTRADO', 'No existe ese club');
    const zona = cfg.club.zonaHoraria;
    return {
      cfg,
      zona,
      fechas,
      ini: instanteLocal(desde, '00:00', zona),
      fin: instanteLocal(sumarDias(hasta, 1), '00:00', zona),
    };
  }

  async resumen(clubId: string, desde: string, hasta: string) {
    const { cfg, zona, fechas, ini, fin } = await this.rango(clubId, desde, hasta);
    const db = this.e.db;
    const enRango = (col: Column) => and(gte(col, ini), lt(col, fin));
    const diaLocal = (col: unknown) =>
      sql<string>`to_char((${col} AT TIME ZONE ${zona})::date, 'YYYY-MM-DD')`;

    const [
      ocupan,
      porEstado,
      porOrigen,
      cobros,
      devoluciones,
      mostrador,
      cargadoATurnos,
      descuentos,
      jugados,
      frecuentes,
      ausentes,
      nuevos,
      productos,
    ] = await Promise.all([
      db
        .select({ canchaId: turnos.canchaId, inicio: turnos.inicio, fin: turnos.fin, origen: turnos.origen })
        .from(turnos)
        .where(
          and(
            eq(turnos.clubId, clubId),
            inArray(turnos.estado, [...OCUPAN]),
            sql`${turnos.rango} && tstzrange(${ini.toISOString()}::timestamptz, ${fin.toISOString()}::timestamptz, '[)')`,
          ),
        ),
      db
        .select({ estado: turnos.estado, n: count() })
        .from(turnos)
        .where(and(eq(turnos.clubId, clubId), ne(turnos.origen, 'BLOQUEO'), enRango(turnos.inicio)))
        .groupBy(turnos.estado),
      db
        .select({ origen: turnos.origen, n: count() })
        .from(turnos)
        .where(
          and(
            eq(turnos.clubId, clubId),
            ne(turnos.origen, 'BLOQUEO'),
            inArray(turnos.estado, [...OCUPAN]),
            enRango(turnos.inicio),
          ),
        )
        .groupBy(turnos.origen),
      db
        .select({
          dia: diaLocal(sql`coalesce(${pagos.acreditadoEn}, ${pagos.creadoEn})`),
          medio: pagos.proveedor,
          concepto: pagos.concepto,
          monto: sql<string>`sum(${pagos.monto})`,
        })
        .from(pagos)
        .where(
          and(
            eq(pagos.clubId, clubId),
            eq(pagos.estado, 'APROBADO'),
            sql`coalesce(${pagos.acreditadoEn}, ${pagos.creadoEn}) >= ${ini.toISOString()}::timestamptz`,
            sql`coalesce(${pagos.acreditadoEn}, ${pagos.creadoEn}) < ${fin.toISOString()}::timestamptz`,
          ),
        )
        .groupBy(sql`1`, pagos.proveedor, pagos.concepto),
      db
        .select({ dia: diaLocal(reembolsos.hechoEn), monto: sql<string>`sum(${reembolsos.monto})` })
        .from(reembolsos)
        .where(
          and(eq(reembolsos.clubId, clubId), eq(reembolsos.estado, 'HECHO'), enRango(reembolsos.hechoEn)),
        )
        .groupBy(sql`1`),
      db
        .select({
          dia: diaLocal(ventasCantina.creadoEn),
          medio: ventasCantina.medio,
          monto: sql<string>`sum(${ventasCantina.total})`,
        })
        .from(ventasCantina)
        .where(
          and(
            eq(ventasCantina.clubId, clubId),
            isNull(ventasCantina.anuladaEn),
            isNull(ventasCantina.turnoId),
            enRango(ventasCantina.creadoEn),
          ),
        )
        .groupBy(sql`1`, ventasCantina.medio),
      db
        .select({ monto: sql<string>`coalesce(sum(${ventasCantina.total}), 0)` })
        .from(ventasCantina)
        .where(
          and(
            eq(ventasCantina.clubId, clubId),
            isNull(ventasCantina.anuladaEn),
            sql`${ventasCantina.turnoId} IS NOT NULL`,
            enRango(ventasCantina.creadoEn),
          ),
        ),
      db
        .select({ monto: sql<string>`coalesce(sum(${canjes.montoAplicado}), 0)`, n: count() })
        .from(canjes)
        .where(and(eq(canjes.clubId, clubId), eq(canjes.estado, 'USADO'), enRango(canjes.usadoEn))),
      db
        .select({
          canchaId: turnos.canchaId,
          precioTotal: turnos.precioTotal,
          consumos: consumosDeTurnoSql,
          descuentos: descuentosDeTurnoSql,
          pagado: pagadoDeTurnoSql,
        })
        .from(turnos)
        .where(and(eq(turnos.clubId, clubId), eq(turnos.estado, 'PRESENTE'), enRango(turnos.inicio))),
      db
        .select({
          id: clientes.id,
          nombre: clientes.nombre,
          telefono: clientes.telefonoE164,
          partidos: count(),
        })
        .from(turnos)
        .innerJoin(clientes, eq(clientes.id, turnos.clienteId))
        .where(and(eq(turnos.clubId, clubId), eq(turnos.estado, 'PRESENTE'), enRango(turnos.inicio)))
        .groupBy(clientes.id)
        .orderBy(desc(count()), asc(clientes.nombre))
        .limit(10),
      db
        .select({
          id: clientes.id,
          nombre: clientes.nombre,
          telefono: clientes.telefonoE164,
          ausencias: count(),
        })
        .from(turnos)
        .innerJoin(clientes, eq(clientes.id, turnos.clienteId))
        .where(and(eq(turnos.clubId, clubId), eq(turnos.estado, 'AUSENTE'), enRango(turnos.inicio)))
        .groupBy(clientes.id)
        .orderBy(desc(count()), asc(clientes.nombre))
        .limit(5),
      db
        .select({ n: count() })
        .from(clientes)
        .where(and(eq(clientes.clubId, clubId), enRango(clientes.creadoEn))),
      db
        .select({
          nombre: inventarioCantina.nombre,
          cantidad: sql<number>`sum(${consumos.cantidad})::int`,
          total: sql<string>`sum(${consumos.cantidad} * ${consumos.precioUnitario})`,
        })
        .from(consumos)
        .innerJoin(ventasCantina, eq(ventasCantina.id, consumos.ventaId))
        .innerJoin(inventarioCantina, eq(inventarioCantina.id, consumos.productoId))
        .where(
          and(
            eq(ventasCantina.clubId, clubId),
            isNull(ventasCantina.anuladaEn),
            enRango(ventasCantina.creadoEn),
          ),
        )
        .groupBy(inventarioCantina.id)
        .orderBy(desc(sql`sum(${consumos.cantidad})`))
        .limit(8),
    ]);

    // --- Ocupación ---------------------------------------------------------------------
    const ids = cfg.canchas.map((c) => c.id);
    const bloques = calcularOcupacion(
      cfg,
      ids,
      fechas,
      ocupan.map((o) => ({ ...o, bloqueo: o.origen === 'BLOQUEO' })),
    );
    const sumar = (bs: Bloque[]) =>
      bs.reduce((a, b) => ({ disponible: a.disponible + b.disponible, ocupado: a.ocupado + b.ocupado }), {
        disponible: 0,
        ocupado: 0,
      });
    const total = sumar(bloques.flat());
    const mapa = Array.from({ length: 7 }, (_, dow) =>
      Array.from({ length: 24 }, (_, h) =>
        sumar(
          fechas.flatMap((d, i) =>
            diaSemana(d) === dow ? [bloques[i]?.[h] ?? { disponible: 0, ocupado: 0 }] : [],
          ),
        ),
      ),
    );
    const porCanchaOcup = cfg.canchas.map((c) => {
      const b = sumar(
        calcularOcupacion(
          cfg,
          [c.id],
          fechas,
          ocupan.filter((o) => o.canchaId === c.id).map((o) => ({ ...o, bloqueo: o.origen === 'BLOQUEO' })),
        ).flat(),
      );
      const suyos = jugados.filter((j) => j.canchaId === c.id);
      return {
        canchaId: c.id,
        nombre: c.nombre,
        ...b,
        partidos: suyos.length,
        facturado: suyos.reduce((a, j) => a + j.precioTotal, 0),
      };
    });

    // --- Plata -------------------------------------------------------------------------
    const n = (s: string | null | undefined) => Number(s ?? 0);
    const porDia = new Map(fechas.map((d) => [d, { cobrado: 0, cantina: 0 }]));
    const porMedio: Record<string, number> = {};
    const porConcepto: Record<string, number> = {};
    for (const c of cobros) {
      const d = porDia.get(c.dia);
      if (d) d.cobrado += n(c.monto);
      porMedio[c.medio] = (porMedio[c.medio] ?? 0) + n(c.monto);
      porConcepto[c.concepto] = (porConcepto[c.concepto] ?? 0) + n(c.monto);
    }
    for (const r of devoluciones) {
      const d = porDia.get(r.dia);
      if (d) d.cobrado -= n(r.monto);
    }
    const devuelto = devoluciones.reduce((a, r) => a + n(r.monto), 0);
    const cantinaPorMedio: Record<string, number> = {};
    for (const v of mostrador) {
      const d = porDia.get(v.dia);
      if (d) d.cantina += n(v.monto);
      if (v.medio) cantinaPorMedio[v.medio] = (cantinaPorMedio[v.medio] ?? 0) + n(v.monto);
    }
    const cobradoTurnos = Object.values(porMedio).reduce((a, b) => a + b, 0) - devuelto;
    const cobradoCantina = Object.values(cantinaPorMedio).reduce((a, b) => a + b, 0);
    const pendientes = jugados.map((j) => saldoDe(aCuenta(j))).filter((s) => s > 0);

    const estados = Object.fromEntries(porEstado.map((e) => [e.estado, e.n])) as Record<string, number>;
    const presentes = estados.PRESENTE ?? 0;
    const ausentesN = estados.AUSENTE ?? 0;

    return {
      desde,
      hasta,
      zonaHoraria: zona,
      ocupacion: {
        ...total,
        porcentaje: total.disponible ? total.ocupado / total.disponible : 0,
        /** [díaSemana 0=domingo][hora 0–23] */
        mapa,
        porCancha: porCanchaOcup,
      },
      dinero: {
        /** Turnos (señas y saldos, neto de devoluciones) + cantina de mostrador. */
        cobrado: cobradoTurnos + cobradoCantina,
        cobradoTurnos,
        cobradoCantina,
        devuelto,
        porMedio: sumarMapas(porMedio, cantinaPorMedio),
        porConcepto,
        descuentosPorPuntos: n(descuentos[0]?.monto),
        canjesAplicados: descuentos[0]?.n ?? 0,
        porCobrar: pendientes.reduce((a, b) => a + b, 0),
        turnosConSaldo: pendientes.length,
      },
      turnos: {
        porEstado: estados,
        porOrigen: Object.fromEntries(porOrigen.map((o) => [o.origen, o.n])),
        jugados: presentes,
        ausentismo: presentes + ausentesN ? ausentesN / (presentes + ausentesN) : 0,
      },
      clientes: {
        nuevos: nuevos[0]?.n ?? 0,
        frecuentes,
        masAusencias: ausentes,
      },
      cantina: {
        mostrador: cobradoCantina,
        aCuentaDeTurnos: n(cargadoATurnos[0]?.monto),
        masVendidos: productos.map((p) => ({ ...p, total: n(p.total) })),
      },
      porDia: fechas.map((d, i) => {
        const b = sumar(bloques[i] ?? []);
        const plata = porDia.get(d) ?? { cobrado: 0, cantina: 0 };
        return { fecha: d, ...b, cobrado: plata.cobrado + plata.cantina };
      }),
    };
  }

  /** Detalle para exportar (una fila por turno, pago o venta del período). */
  async filas(clubId: string, tipo: 'turnos' | 'pagos' | 'ventas', desde: string, hasta: string) {
    const { zona, ini, fin } = await this.rango(clubId, desde, hasta);
    const local = (d: Date | null) => (d ? partesLocales(d, zona) : null);
    if (tipo === 'turnos') {
      const filas = await this.e.db
        .select({
          inicio: turnos.inicio,
          cancha: canchas.nombre,
          cliente: clientes.nombre,
          telefono: clientes.telefonoE164,
          estado: turnos.estado,
          origen: turnos.origen,
          precioTotal: turnos.precioTotal,
          consumos: consumosDeTurnoSql,
          descuentos: descuentosDeTurnoSql,
          pagado: pagadoDeTurnoSql,
        })
        .from(turnos)
        .innerJoin(canchas, eq(canchas.id, turnos.canchaId))
        .leftJoin(clientes, eq(clientes.id, turnos.clienteId))
        .where(
          and(
            eq(turnos.clubId, clubId),
            gte(turnos.inicio, ini),
            lt(turnos.inicio, fin),
            ne(turnos.estado, 'EXPIRADO'),
          ),
        )
        .orderBy(asc(turnos.inicio));
      return {
        columnas: [
          'Fecha',
          'Hora',
          'Cancha',
          'Cliente',
          'Teléfono',
          'Estado',
          'Origen',
          'Precio',
          'Cantina',
          'Descuentos',
          'Pagado',
          'Saldo',
        ],
        filas: filas.map((f) => {
          const c = aCuenta(f);
          const l = local(f.inicio);
          return [
            l?.fecha,
            l?.hora,
            f.cancha,
            f.cliente,
            f.telefono,
            f.estado,
            f.origen,
            c.precioTotal,
            c.consumos,
            c.descuentos,
            c.pagado,
            saldoDe(c),
          ];
        }),
        montos: [7, 8, 9, 10, 11],
      };
    }
    if (tipo === 'pagos') {
      const filas = await this.e.db
        .select({
          en: sql<Date>`coalesce(${pagos.acreditadoEn}, ${pagos.creadoEn})`.mapWith(
            (v: string) => new Date(v),
          ),
          medio: pagos.proveedor,
          concepto: pagos.concepto,
          estado: pagos.estado,
          monto: pagos.monto,
          cliente: clientes.nombre,
          turno: turnos.inicio,
          devuelto: reembolsos.estado,
        })
        .from(pagos)
        .innerJoin(turnos, eq(turnos.id, pagos.turnoId))
        .leftJoin(clientes, eq(clientes.id, turnos.clienteId))
        .leftJoin(reembolsos, eq(reembolsos.pagoId, pagos.id))
        .where(
          and(
            eq(pagos.clubId, clubId),
            inArray(pagos.estado, ['APROBADO', 'REEMBOLSADO']),
            sql`coalesce(${pagos.acreditadoEn}, ${pagos.creadoEn}) >= ${ini.toISOString()}::timestamptz`,
            sql`coalesce(${pagos.acreditadoEn}, ${pagos.creadoEn}) < ${fin.toISOString()}::timestamptz`,
          ),
        )
        .orderBy(sql`2`);
      return {
        columnas: ['Fecha', 'Hora', 'Medio', 'Concepto', 'Monto', 'Cliente', 'Turno', 'Devolución'],
        filas: filas.map((f) => {
          const l = local(f.en);
          const t = local(f.turno);
          return [
            l?.fecha,
            l?.hora,
            f.medio,
            f.concepto,
            f.monto,
            f.cliente,
            t ? `${t.fecha} ${t.hora}` : '',
            f.devuelto ?? '',
          ];
        }),
        montos: [4],
      };
    }
    const lista = await this.e.db
      .select({
        id: ventasCantina.id,
        en: ventasCantina.creadoEn,
        medio: ventasCantina.medio,
        turnoId: ventasCantina.turnoId,
        total: ventasCantina.total,
        anulada: ventasCantina.motivoAnulacion,
        items: sql<string>`(SELECT string_agg(c.cantidad || ' × ' || p.nombre, ', ' ORDER BY p.nombre)
          FROM consumos c JOIN inventario_cantina p ON p.id = c.producto_id WHERE c.venta_id = ventas_cantina.id)`,
      })
      .from(ventasCantina)
      .where(
        and(
          eq(ventasCantina.clubId, clubId),
          gte(ventasCantina.creadoEn, ini),
          lt(ventasCantina.creadoEn, fin),
        ),
      )
      .orderBy(asc(ventasCantina.creadoEn));
    return {
      columnas: ['Fecha', 'Hora', 'Cobro', 'Total', 'Productos', 'Anulada'],
      filas: lista.map((v) => {
        const l = local(v.en);
        return [l?.fecha, l?.hora, v.medio ?? 'A cuenta del turno', v.total, v.items, v.anulada ?? ''];
      }),
      montos: [3],
    };
  }
}

function sumarMapas(a: Record<string, number>, b: Record<string, number>) {
  const r = { ...a };
  for (const [k, v] of Object.entries(b)) r[k] = (r[k] ?? 0) + v;
  return r;
}

/**
 * CSV para Excel en castellano: separador `;`, montos en pesos con coma decimal y BOM
 * para que abra en UTF-8. Las celdas que empiezan con = + - @ se escapan (inyección de
 * fórmulas: los nombres de clientes los escribe cualquiera).
 */
export function aCsv(r: { columnas: string[]; filas: unknown[][]; montos: number[] }) {
  const celda = (v: unknown, i: number) => {
    let s: string;
    if (v === null || v === undefined) s = '';
    else if (r.montos.includes(i) && typeof v === 'number') s = (v / 100).toFixed(2).replace('.', ',');
    else s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !(r.montos.includes(i) && /^-?\d/.test(s))) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [
    r.columnas.map((c, i) => celda(c, -1 - i)).join(';'),
    ...r.filas.map((f) => f.map(celda).join(';')),
  ];
  return `﻿${lineas.join('\r\n')}\r\n`;
}
