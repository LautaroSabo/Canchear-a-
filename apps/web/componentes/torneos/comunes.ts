// Constantes de torneos sin 'use client': se usan también desde páginas del servidor.

import type { EstadoTorneo, VistaTorneo } from '@/lib/tipos';
import type { Tono } from '../ui';

export const NOMBRE_RONDA: Record<number, string> = {
  1: 'Final',
  2: 'Semifinales',
  4: 'Cuartos de final',
  8: 'Octavos de final',
  16: 'Dieciseisavos de final',
};

export const ESTADO_TORNEO: Record<EstadoTorneo, { texto: string; tono: Tono }> = {
  INSCRIPCION: { texto: 'Inscripción abierta', tono: 'info' },
  EN_CURSO: { texto: 'En juego', tono: 'ok' },
  FINALIZADO: { texto: 'Terminado', tono: 'neutro' },
};

export const letraGrupo = (n: number) => String.fromCharCode(64 + n);

/** "Martes y jueves de 20:00 a 23:00 · fútbol 5". */
export function resumenFormato(v: VistaTorneo['torneo']) {
  const partes = [`Fútbol ${v.jugadoresPorLado}`];
  if (v.cantidadGrupos > 1) partes.push(`${v.cantidadGrupos} grupos`);
  else partes.push(v.clasificanPorGrupo > 0 ? 'todos contra todos' : 'liga');
  if (v.idaYVuelta) partes.push('ida y vuelta');
  if (v.clasificanPorGrupo > 0) partes.push('con eliminación');
  return partes.join(' · ');
}
