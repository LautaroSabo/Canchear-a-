// Lógica de torneos sin base de datos: fixture todos contra todos, reparto en grupos,
// tabla de posiciones y cuadro de eliminación. Los equipos se identifican por id.

export interface Cruce {
  /** Número de fecha (jornada), desde 1. */
  fecha: number;
  local: string;
  visitante: string;
}

/**
 * Todos contra todos por el método del círculo: en cada fecha juegan todos (con número
 * impar, uno descansa por fecha). La localía se alterna para que nadie sea siempre local.
 * Ida y vuelta: la segunda rueda repite los cruces con la localía invertida.
 */
export function todosContraTodos(equipos: string[], idaYVuelta = false): Cruce[] {
  if (equipos.length < 2) return [];
  const lista: (string | null)[] = equipos.length % 2 === 0 ? [...equipos] : [...equipos, null];
  const n = lista.length;
  const cruces: Cruce[] = [];
  for (let f = 0; f < n - 1; f++) {
    for (let i = 0; i < n / 2; i++) {
      const a = lista[i];
      const b = lista[n - 1 - i];
      if (!a || !b) continue;
      // El fijo (posición 0) alterna localía fecha a fecha; el resto, según la posición.
      const invertir = i === 0 ? f % 2 === 1 : i % 2 === 1;
      cruces.push({ fecha: f + 1, local: invertir ? b : a, visitante: invertir ? a : b });
    }
    // Rotación: el primero queda fijo, el resto gira una posición.
    lista.splice(1, 0, lista.pop() as string | null);
  }
  if (!idaYVuelta) return cruces;
  const fechas = n - 1;
  return [
    ...cruces,
    ...cruces.map((c) => ({ fecha: c.fecha + fechas, local: c.visitante, visitante: c.local })),
  ];
}

/**
 * Reparte equipos en `cantidad` grupos en zigzag (1-2-3-3-2-1…), así si vienen ordenados
 * por nivel (cabezas de serie primero) los grupos quedan parejos. Quien sortea mezcla antes.
 */
export function repartirEnGrupos<T>(equipos: T[], cantidad: number): T[][] {
  const grupos: T[][] = Array.from({ length: Math.max(1, cantidad) }, () => []);
  equipos.forEach((e, i) => {
    const vuelta = Math.floor(i / grupos.length);
    const pos = i % grupos.length;
    grupos[vuelta % 2 === 0 ? pos : grupos.length - 1 - pos]?.push(e);
  });
  return grupos;
}

export interface ResultadoPartido {
  local: string;
  visitante: string;
  golesLocal: number;
  golesVisitante: number;
}

export interface FilaTabla {
  equipo: string;
  pj: number;
  pg: number;
  pe: number;
  pp: number;
  gf: number;
  gc: number;
  dg: number;
  pts: number;
}

/**
 * Tabla de un grupo. Orden: puntos, diferencia de gol, goles a favor, resultado entre
 * los empatados (puntos en esos partidos) y, si sigue igual, el orden de inscripción.
 */
export function tablaDePosiciones(
  equipos: string[],
  partidos: ResultadoPartido[],
  puntos = { victoria: 3, empate: 1 },
): FilaTabla[] {
  const filas = new Map<string, FilaTabla>(
    equipos.map((e) => [e, { equipo: e, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, dg: 0, pts: 0 }]),
  );
  const sumar = (equipo: string, aFavor: number, enContra: number) => {
    const f = filas.get(equipo);
    if (!f) return;
    f.pj++;
    f.gf += aFavor;
    f.gc += enContra;
    f.dg = f.gf - f.gc;
    if (aFavor > enContra) {
      f.pg++;
      f.pts += puntos.victoria;
    } else if (aFavor === enContra) {
      f.pe++;
      f.pts += puntos.empate;
    } else f.pp++;
  };
  for (const p of partidos) {
    sumar(p.local, p.golesLocal, p.golesVisitante);
    sumar(p.visitante, p.golesVisitante, p.golesLocal);
  }
  const orden = new Map(equipos.map((e, i) => [e, i]));
  const entreSi = (a: string, b: string) => {
    let pa = 0;
    let pb = 0;
    for (const p of partidos) {
      const ida = p.local === a && p.visitante === b;
      const vuelta = p.local === b && p.visitante === a;
      if (!ida && !vuelta) continue;
      const ga = ida ? p.golesLocal : p.golesVisitante;
      const gb = ida ? p.golesVisitante : p.golesLocal;
      if (ga > gb) pa += puntos.victoria;
      else if (gb > ga) pb += puntos.victoria;
      else {
        pa += puntos.empate;
        pb += puntos.empate;
      }
    }
    return pb - pa;
  };
  return [...filas.values()].sort(
    (a, b) =>
      b.pts - a.pts ||
      b.dg - a.dg ||
      b.gf - a.gf ||
      entreSi(a.equipo, b.equipo) ||
      (orden.get(a.equipo) ?? 0) - (orden.get(b.equipo) ?? 0),
  );
}

export interface Clasificado {
  equipo: string;
  grupo: number;
  /** Posición en su grupo (1 = primero). */
  posicion: number;
  fila: FilaTabla;
}

/**
 * Los que pasan a la eliminación, ordenados como cabezas de serie: todos los primeros
 * (el mejor primero adelante), después los segundos, etc.
 */
export function clasificados(tablas: FilaTabla[][], porGrupo: number): Clasificado[] {
  const lista: Clasificado[] = [];
  for (let pos = 1; pos <= porGrupo; pos++) {
    const deEsaPosicion = tablas
      .map((t, g) => ({ fila: t[pos - 1], grupo: g + 1 }))
      .filter((x): x is { fila: FilaTabla; grupo: number } => Boolean(x.fila))
      .sort(
        (a, b) =>
          b.fila.pts - a.fila.pts || b.fila.dg - a.fila.dg || b.fila.gf - a.fila.gf || a.grupo - b.grupo,
      );
    for (const x of deEsaPosicion)
      lista.push({ equipo: x.fila.equipo, grupo: x.grupo, posicion: pos, fila: x.fila });
  }
  return lista;
}

/** Orden de siembra estándar: en un cuadro de 8, 1-8, 4-5, 2-7, 3-6 (1 y 2 solo en la final). */
function ordenSiembra(tamano: number): number[] {
  let orden = [1];
  while (orden.length < tamano) {
    const n = orden.length * 2 + 1;
    orden = orden.flatMap((s) => [s, n - s]);
  }
  return orden;
}

export interface CruceEliminacion {
  /** Cantidad de partidos de la ronda: 1 = final, 2 = semis, 4 = cuartos… */
  ronda: number;
  /** Posición dentro de la ronda, desde 0. Los ganadores de 2k y 2k+1 se cruzan después. */
  orden: number;
  local: string | null;
  visitante: string | null;
}

export const NOMBRE_RONDA: Record<number, string> = {
  1: 'Final',
  2: 'Semifinal',
  4: 'Cuartos de final',
  8: 'Octavos de final',
  16: 'Dieciseisavos de final',
};

/**
 * Primera ronda del cuadro. Con un número que no es potencia de 2, los mejores sembrados
 * pasan directo (bye: el rival es null). Si dos del mismo grupo se cruzan en la primera
 * ronda, se intercambia el de abajo con el de otro cruce para separarlos.
 */
export function primeraRonda(sembrados: { equipo: string; grupo?: number }[]): CruceEliminacion[] {
  if (sembrados.length < 2) return [];
  let tamano = 2;
  while (tamano < sembrados.length) tamano *= 2;
  const siembra = ordenSiembra(tamano);
  const deSiembra = (s: number) => sembrados[s - 1] ?? null;
  const cruces = Array.from({ length: tamano / 2 }, (_, i) => ({
    local: deSiembra(siembra[2 * i] as number),
    visitante: deSiembra(siembra[2 * i + 1] as number),
  }));
  const mismoGrupo = (c: (typeof cruces)[number]) =>
    c.local?.grupo !== undefined && c.local.grupo === c.visitante?.grupo;
  for (const c of cruces) {
    if (!mismoGrupo(c)) continue;
    const otro = cruces.find(
      (o) =>
        o !== c &&
        o.visitante &&
        o.visitante.grupo !== c.local?.grupo &&
        o.local?.grupo !== c.visitante?.grupo,
    );
    if (otro) [c.visitante, otro.visitante] = [otro.visitante, c.visitante];
  }
  return cruces.map((c, orden) => ({
    ronda: tamano / 2,
    orden,
    local: c.local?.equipo ?? null,
    visitante: c.visitante?.equipo ?? null,
  }));
}
