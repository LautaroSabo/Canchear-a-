// Utilidades de zona horaria sin dependencias (Intl). Las fechas "locales" del club se
// manejan como strings 'YYYY-MM-DD' y las horas como 'HH:MM' (o 'HH:MM:SS', como las
// devuelve Postgres para columnas `time`).

export interface PartesLocales {
  fecha: string;
  hora: string;
  /** 0 = domingo … 6 = sábado (igual que EXTRACT(DOW) y horarios_apertura.dia_semana). */
  diaSemana: number;
  /** Minutos desde la medianoche local. */
  minutos: number;
}

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(zona: string) {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formateadores.set(zona, f);
  }
  return f;
}

function componentes(instante: Date, zona: string) {
  const p = Object.fromEntries(
    formateador(zona)
      .formatToParts(instante)
      .map((x) => [x.type, x.value]),
  );
  return {
    anio: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour),
    minuto: Number(p.minute),
    segundo: Number(p.second),
  };
}

const dos = (n: number) => String(n).padStart(2, '0');

export function partesLocales(instante: Date, zona: string): PartesLocales {
  const c = componentes(instante, zona);
  const fecha = `${c.anio}-${dos(c.mes)}-${dos(c.dia)}`;
  return {
    fecha,
    hora: `${dos(c.hora)}:${dos(c.minuto)}`,
    diaSemana: diaSemana(fecha),
    minutos: c.hora * 60 + c.minuto,
  };
}

/** Diferencia (minutos) entre la hora local de `zona` y UTC en ese instante. */
function offsetMinutos(instante: Date, zona: string): number {
  const c = componentes(instante, zona);
  const comoUtc = Date.UTC(c.anio, c.mes - 1, c.dia, c.hora, c.minuto, c.segundo);
  return Math.round((comoUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60_000);
}

/** Instante UTC que corresponde a `fecha` + `hora` en la zona del club. */
export function instanteLocal(fecha: string, hora: string, zona: string): Date {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const ingenuo = Date.UTC(a, m - 1, d) + aMinutos(hora) * 60_000;
  // Dos pasadas: la segunda corrige si el primer offset cae del otro lado de un cambio de horario.
  const offset = offsetMinutos(new Date(ingenuo), zona);
  const corregido = offsetMinutos(new Date(ingenuo - offset * 60_000), zona);
  return new Date(ingenuo - corregido * 60_000);
}

export function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function diaSemana(fecha: string): number {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

export const sumarMinutos = (instante: Date, minutos: number) =>
  new Date(instante.getTime() + minutos * 60_000);

/**
 * ¿El minuto local `minuto` cae en la franja [desde, hasta)? `hasta = 00:00` es fin del día
 * y `hasta < desde` es una franja que cruza la medianoche (ej. 22:00–02:00).
 */
export function enFranja(desde: string, hasta: string, minuto: number): boolean {
  const d = aMinutos(desde);
  const h = aMinutos(hasta) || 24 * 60;
  return d < h ? minuto >= d && minuto < h : minuto >= d || minuto < h;
}
