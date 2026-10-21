import { calcularSena, partesLocales, type ReglaSena, resolverRegla, resolverTarifa } from '@cancheria/core';
import type { Cancha, ConfigClub } from './config-club.ts';

export interface Cotizacion {
  /** centavos */
  precio: number;
  montoSena: number;
  regla: ReglaSena | null;
}

/** Precio y seña de un turno según la hora y el día en que empieza; null si no hay tarifa. */
export function cotizarTurno(cfg: ConfigClub, cancha: Cancha, inicio: Date): Cotizacion | null {
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
