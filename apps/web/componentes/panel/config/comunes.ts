'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { panel } from '@/lib/api';
import type { ConfigClub } from '@/lib/tipos';
import { useClubActual } from '../sesion';

export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const;
/** Lunes primero, como se piensa la semana en el club. */
export const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0] as const;

export const SUPERFICIES = {
  SINTETICO: 'Sintético',
  CESPED_NATURAL: 'Césped natural',
  CEMENTO: 'Cemento',
  PARQUET: 'Parquet',
  OTRO: 'Otra',
} as const;

/** "45.000" o "45000,50" → centavos. */
export const aCentavos = (texto: string) =>
  Math.round(Number(texto.replace(/\./g, '').replace(',', '.')) * 100);
export const aTextoPesos = (centavos: number) =>
  (centavos / 100).toLocaleString('es-AR', { maximumFractionDigits: 2, useGrouping: false });
export const pesosValidos = (texto: string) => /^\d{1,7}([.,]\d{1,2})?$/.test(texto.replace(/\./g, ''));

export const franjaTexto = (desde: string | null, hasta: string | null) =>
  desde && hasta ? `${desde} a ${hasta === '00:00' ? '24:00' : hasta}` : 'Todo el día';

export function useConfig() {
  const { clubId } = useClubActual();
  return useQuery({
    queryKey: ['config', clubId],
    queryFn: () => panel.get<ConfigClub>(`/clubs/${clubId}/config`),
  });
}

/**
 * Mutación de configuración: al terminar refresca la configuración y todo lo que
 * depende de ella (agenda, precios del público, datos del club).
 */
export function useGuardar<A = void, R = unknown>(
  fn: (clubId: string, arg: A) => Promise<R>,
  alTerminar?: (r: R) => void,
) {
  const { clubId } = useClubActual();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (arg: A) => fn(clubId, arg),
    onSuccess: (r) => {
      qc.invalidateQueries();
      alTerminar?.(r);
    },
  });
}
