import { aMinutos, instanteLocal, sumarDias, sumarMinutos } from './tiempo.ts';

export interface HorarioApertura {
  diaSemana: number;
  abre: string;
  cierra: string;
}

export interface DiaEspecial {
  fecha: string;
  cerrado: boolean;
  abre: string | null;
  cierra: string | null;
}

export interface Intervalo {
  inicio: Date;
  fin: Date;
}

export type EstadoSlot = 'LIBRE' | 'OCUPADO' | 'PASADO';

/**
 * Ventanas de apertura de la jornada `fecha`. Si cierra <= abre, la jornada termina al
 * día siguiente (ej. sábado 09:00 → domingo 02:00): esos turnos de madrugada pertenecen
 * a la jornada del sábado.
 */
export function ventanasDeJornada(
  fecha: string,
  zona: string,
  horarios: HorarioApertura[],
  especial?: DiaEspecial,
): Intervalo[] {
  let franjas: { abre: string; cierra: string }[];
  if (especial) {
    if (especial.cerrado) return [];
    franjas =
      especial.abre && especial.cierra
        ? [{ abre: especial.abre, cierra: especial.cierra }]
        : horariosDelDia(fecha, horarios);
  } else {
    franjas = horariosDelDia(fecha, horarios);
  }

  return franjas
    .map(({ abre, cierra }) => ({
      inicio: instanteLocal(fecha, abre, zona),
      fin: instanteLocal(aMinutos(cierra) <= aMinutos(abre) ? sumarDias(fecha, 1) : fecha, cierra, zona),
    }))
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

function horariosDelDia(fecha: string, horarios: HorarioApertura[]) {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return horarios.filter((h) => h.diaSemana === dia);
}

/** Turnos consecutivos de `duracionMin` desde la apertura; el último debe terminar antes del cierre. */
export function generarSlots(ventanas: Intervalo[], duracionMin: number): Intervalo[] {
  const slots: Intervalo[] = [];
  for (const v of ventanas) {
    for (
      let inicio = v.inicio;
      sumarMinutos(inicio, duracionMin) <= v.fin;
      inicio = sumarMinutos(inicio, duracionMin)
    ) {
      slots.push({ inicio, fin: sumarMinutos(inicio, duracionMin) });
    }
  }
  return slots;
}

export const seSolapan = (a: Intervalo, b: Intervalo) => a.inicio < b.fin && b.inicio < a.fin;

/**
 * Marca cada slot: PASADO si empieza antes de `ahora + anticipacionMin`, OCUPADO si pisa
 * algún turno que ocupa la cancha, LIBRE en otro caso.
 */
export function marcarDisponibilidad(
  slots: Intervalo[],
  ocupados: Intervalo[],
  ahora: Date,
  anticipacionMin = 0,
): (Intervalo & { estado: EstadoSlot })[] {
  const limite = sumarMinutos(ahora, anticipacionMin);
  return slots.map((s) => ({
    ...s,
    estado: s.inicio < limite ? 'PASADO' : ocupados.some((o) => seSolapan(s, o)) ? 'OCUPADO' : 'LIBRE',
  }));
}
