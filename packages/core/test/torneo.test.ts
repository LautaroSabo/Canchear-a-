import { describe, expect, it } from 'vitest';
import {
  clasificados,
  primeraRonda,
  repartirEnGrupos,
  tablaDePosiciones,
  todosContraTodos,
} from '../src/torneo.ts';

const equipos = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
const pares = (cs: { local: string; visitante: string }[]) =>
  cs.map((c) => [c.local, c.visitante].sort().join('-')).sort();

describe('todos contra todos', () => {
  it.each([2, 3, 4, 5, 6, 7, 8])(
    'con %i equipos: cada par se cruza una vez y nadie juega dos veces por fecha',
    (n) => {
      const cruces = todosContraTodos(equipos(n));
      const esperados = (n * (n - 1)) / 2;
      expect(cruces).toHaveLength(esperados);
      expect(new Set(pares(cruces)).size).toBe(esperados);
      const porFecha = new Map<number, typeof cruces>();
      for (const c of cruces) porFecha.set(c.fecha, [...(porFecha.get(c.fecha) ?? []), c]);
      expect(porFecha.size).toBe(n % 2 === 0 ? n - 1 : n);
      for (const fecha of porFecha.values()) {
        const jugando = fecha.flatMap((c) => [c.local, c.visitante]);
        expect(new Set(jugando).size).toBe(jugando.length);
      }
    },
  );

  it('la localía queda repartida', () => {
    const cruces = todosContraTodos(equipos(6));
    for (const e of equipos(6)) {
      const local = cruces.filter((c) => c.local === e).length;
      expect(local).toBeGreaterThanOrEqual(2);
      expect(local).toBeLessThanOrEqual(3);
    }
  });

  it('ida y vuelta: la segunda rueda repite los cruces con la localía invertida', () => {
    const cruces = todosContraTodos(equipos(4), true);
    expect(cruces).toHaveLength(12);
    const ida = cruces.filter((c) => c.fecha <= 3);
    const vuelta = cruces.filter((c) => c.fecha > 3);
    expect(vuelta.map((c) => `${c.visitante}-${c.local}`).sort()).toEqual(
      ida.map((c) => `${c.local}-${c.visitante}`).sort(),
    );
  });
});

describe('grupos', () => {
  it('reparte en zigzag para que queden parejos', () => {
    expect(repartirEnGrupos(equipos(8), 2)).toEqual([
      ['A', 'D', 'E', 'H'],
      ['B', 'C', 'F', 'G'],
    ]);
    expect(repartirEnGrupos(equipos(7), 3).map((g) => g.length)).toEqual([3, 2, 2]);
  });
});

describe('tabla de posiciones', () => {
  it('suma 3 por victoria y 1 por empate, y ordena por puntos, diferencia y goles', () => {
    const t = tablaDePosiciones(
      ['A', 'B', 'C'],
      [
        { local: 'A', visitante: 'B', golesLocal: 3, golesVisitante: 1 },
        { local: 'B', visitante: 'C', golesLocal: 2, golesVisitante: 2 },
        { local: 'C', visitante: 'A', golesLocal: 0, golesVisitante: 0 },
      ],
    );
    expect(t.map((f) => [f.equipo, f.pts, f.dg])).toEqual([
      ['A', 4, 2],
      ['C', 2, 0],
      ['B', 1, -2],
    ]);
    expect(t[0]).toMatchObject({ pj: 2, pg: 1, pe: 1, pp: 0, gf: 3, gc: 1 });
  });

  it('empatados en todo: decide el partido entre ellos', () => {
    const t = tablaDePosiciones(
      ['A', 'B', 'C', 'D'],
      [
        { local: 'A', visitante: 'B', golesLocal: 1, golesVisitante: 2 },
        { local: 'A', visitante: 'C', golesLocal: 3, golesVisitante: 0 },
        { local: 'B', visitante: 'D', golesLocal: 0, golesVisitante: 2 },
      ],
    );
    // A y B: 3 puntos, +2 y... A: GF 4 GC 2 (+2); B: GF 2 GC 3 (-1). Se ordena por dg.
    expect(t[0]?.equipo).toBe('A');
    const empate = tablaDePosiciones(
      ['A', 'B'],
      [
        { local: 'A', visitante: 'B', golesLocal: 0, golesVisitante: 1 },
        { local: 'B', visitante: 'A', golesLocal: 0, golesVisitante: 1 },
      ],
    );
    expect(empate.map((f) => f.equipo)).toEqual(['A', 'B']);
  });
});

describe('eliminación', () => {
  it('cruza 1° de un grupo con 2° del otro', () => {
    const tablas = [
      tablaDePosiciones(
        ['A1', 'A2', 'A3'],
        [
          { local: 'A1', visitante: 'A2', golesLocal: 2, golesVisitante: 0 },
          { local: 'A2', visitante: 'A3', golesLocal: 1, golesVisitante: 0 },
        ],
      ),
      tablaDePosiciones(
        ['B1', 'B2', 'B3'],
        [
          { local: 'B1', visitante: 'B2', golesLocal: 2, golesVisitante: 0 },
          { local: 'B2', visitante: 'B3', golesLocal: 1, golesVisitante: 0 },
        ],
      ),
    ];
    const cl = clasificados(tablas, 2);
    expect(cl.map((c) => c.equipo)).toEqual(['A1', 'B1', 'A2', 'B2']);
    const r = primeraRonda(cl.map((c) => ({ equipo: c.equipo, grupo: c.grupo })));
    expect(r.map((c) => [c.local, c.visitante])).toEqual([
      ['A1', 'B2'],
      ['B1', 'A2'],
    ]);
    // Ningún cruce entre equipos del mismo grupo.
    for (const c of r) expect(c.local?.[0]).not.toBe(c.visitante?.[0]);
    expect(r).toHaveLength(2);
    expect(r[0]?.ronda).toBe(2);
  });

  it('con 6 clasificados, el cuadro es de 8 y los dos mejores pasan directo', () => {
    const r = primeraRonda(equipos(6).map((equipo) => ({ equipo })));
    expect(r).toHaveLength(4);
    expect(r.filter((c) => !c.local || !c.visitante).map((c) => c.local)).toEqual(['A', 'B']);
    expect(r.map((c) => [c.local, c.visitante])).toEqual([
      ['A', null],
      ['D', 'E'],
      ['B', null],
      ['C', 'F'],
    ]);
  });
});
