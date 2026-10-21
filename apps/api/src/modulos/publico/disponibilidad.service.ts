import {
  calcularSena,
  type EstadoSlot,
  generarSlots,
  type Intervalo,
  marcarDisponibilidad,
  partesLocales,
  type ReglaSena,
  resolverRegla,
  resolverTarifa,
  sumarDias,
  ventanasDeJornada,
} from '@cancheria/core';
import type { Db } from '@cancheria/db';
import { ESTADOS_QUE_OCUPAN, turnos } from '@cancheria/db/schema';
import { and, eq, gt, inArray, ne, or, sql } from 'drizzle-orm';
import type { Reloj } from '../../app.ts';
import type { Config } from '../../config.ts';
import { ErrorNegocio } from '../../errores.ts';
import type { Cancha, ConfigClub } from './club.repo.ts';

export interface SlotPublico {
  inicio: string;
  fin: string;
  estado: EstadoSlot;
  /** centavos */
  precio: number;
  montoSena: number;
  requiereSena: boolean;
}

export interface CanchaConSlots {
  id: string;
  nombre: string;
  jugadoresPorLado: number;
  superficie: string;
  techada: boolean;
  duracionMin: number;
  slots: SlotPublico[];
}

export interface Cotizacion {
  precio: number;
  montoSena: number;
  regla: ReglaSena | null;
}

export class ServicioDisponibilidad {
  constructor(
    private readonly db: Db,
    private readonly reloj: Reloj,
    private readonly config: Pick<Config, 'anticipacionMinimaMin' | 'diasMaximosAnticipacion'>,
  ) {}

  /** Se acepta desde ayer (su jornada puede seguir abierta pasada la medianoche) hasta N días. */
  validarFecha(cfg: ConfigClub, fecha: string) {
    const hoy = partesLocales(this.reloj(), cfg.club.zonaHoraria).fecha;
    if (fecha < sumarDias(hoy, -1) || fecha > sumarDias(hoy, this.config.diasMaximosAnticipacion)) {
      throw new ErrorNegocio(
        422,
        'FECHA_FUERA_DE_RANGO',
        `Se puede reservar hasta ${this.config.diasMaximosAnticipacion} días adelante`,
      );
    }
  }

  slotsDeCancha(cfg: ConfigClub, cancha: Cancha, fecha: string): Intervalo[] {
    const especial = cfg.especiales.find((e) => e.fecha === fecha);
    return generarSlots(
      ventanasDeJornada(fecha, cfg.club.zonaHoraria, cfg.horarios, especial),
      cancha.duracionTurnoMin,
    );
  }

  /** Precio y seña de un turno; null si ninguna tarifa cubre ese horario. */
  cotizar(cfg: ConfigClub, cancha: Cancha, inicio: Date): Cotizacion | null {
    const local = partesLocales(inicio, cfg.club.zonaHoraria);
    const contexto = {
      canchaId: cancha.id,
      diaSemana: local.diaSemana,
      minutoInicio: local.minutos,
      fecha: local.fecha,
    };
    const tarifa = resolverTarifa(cfg.tarifas, contexto);
    if (!tarifa) return null;
    const regla = resolverRegla(cfg.reglas, contexto);
    return { precio: tarifa.precio, montoSena: calcularSena(tarifa.precio, regla), regla };
  }

  async jornada(
    cfg: ConfigClub,
    fecha: string,
    filtro: { jugadores?: number | undefined; canchaId?: string | undefined } = {},
  ): Promise<CanchaConSlots[]> {
    this.validarFecha(cfg, fecha);
    const ahora = this.reloj();
    const lista = cfg.canchas.filter(
      (c) =>
        (filtro.jugadores === undefined || c.jugadoresPorLado === filtro.jugadores) &&
        (filtro.canchaId === undefined || c.id === filtro.canchaId),
    );
    const slotsPorCancha = new Map(lista.map((c) => [c.id, this.slotsDeCancha(cfg, c, fecha)]));
    const todos = [...slotsPorCancha.values()].flat();
    const ocupados =
      todos.length > 0
        ? await this.ocupados(
            cfg.club.id,
            lista.map((c) => c.id),
            new Date(Math.min(...todos.map((s) => s.inicio.getTime()))),
            new Date(Math.max(...todos.map((s) => s.fin.getTime()))),
            ahora,
          )
        : new Map<string, Intervalo[]>();

    return lista.map((cancha) => ({
      id: cancha.id,
      nombre: cancha.nombre,
      jugadoresPorLado: cancha.jugadoresPorLado,
      superficie: cancha.superficie,
      techada: cancha.techada,
      duracionMin: cancha.duracionTurnoMin,
      slots: marcarDisponibilidad(
        slotsPorCancha.get(cancha.id) ?? [],
        ocupados.get(cancha.id) ?? [],
        ahora,
        this.config.anticipacionMinimaMin,
      ).flatMap((s) => {
        const cotizacion = this.cotizar(cfg, cancha, s.inicio);
        // Un horario sin tarifa es un error de configuración del club: no se ofrece.
        if (!cotizacion) return [];
        return [
          {
            inicio: s.inicio.toISOString(),
            fin: s.fin.toISOString(),
            estado: s.estado,
            precio: cotizacion.precio,
            montoSena: cotizacion.montoSena,
            requiereSena: cotizacion.montoSena > 0,
          },
        ];
      }),
    }));
  }

  /**
   * Turnos que ocupan las canchas en [desde, hasta). Un PRE_RESERVADO vencido cuenta como
   * libre aunque el worker todavía no lo haya pasado a EXPIRADO.
   */
  private async ocupados(clubId: string, canchaIds: string[], desde: Date, hasta: Date, ahora: Date) {
    const filas = await this.db
      .select({ canchaId: turnos.canchaId, inicio: turnos.inicio, fin: turnos.fin })
      .from(turnos)
      .where(
        and(
          eq(turnos.clubId, clubId),
          inArray(turnos.canchaId, canchaIds),
          sql`${turnos.rango} && tstzrange(${desde.toISOString()}::timestamptz, ${hasta.toISOString()}::timestamptz, '[)')`,
          inArray(turnos.estado, [...ESTADOS_QUE_OCUPAN]),
          or(ne(turnos.estado, 'PRE_RESERVADO'), gt(turnos.expiraEn, ahora)),
        ),
      );
    const porCancha = new Map<string, Intervalo[]>();
    for (const f of filas) {
      const lista = porCancha.get(f.canchaId) ?? [];
      lista.push({ inicio: f.inicio, fin: f.fin });
      porCancha.set(f.canchaId, lista);
    }
    return porCancha;
  }
}
