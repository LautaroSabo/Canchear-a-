import { describe, expect, it } from 'vitest';
import { generarSlots, marcarDisponibilidad, ventanasDeJornada } from '../src/grilla.ts';
import { instanteLocal } from '../src/tiempo.ts';

const BA = 'America/Argentina/Buenos_Aires';
const local = (fecha: string, hora: string) => instanteLocal(fecha, hora, BA);
const horarios = [
  { diaSemana: 5, abre: '10:00', cierra: '00:00' }, // viernes hasta medianoche
  { diaSemana: 6, abre: '09:00', cierra: '02:00' }, // sábado hasta las 2 del domingo
];

describe('grilla de turnos', () => {
  it('la jornada del sábado termina el domingo a las 02:00', () => {
    const [v] = ventanasDeJornada('2030-01-05', BA, horarios);
    expect(v).toEqual({ inicio: local('2030-01-05', '09:00'), fin: local('2030-01-06', '02:00') });
    expect(generarSlots([v!], 60)).toHaveLength(17); // 09–10 … 01–02
  });

  it('cierre a las 00:00 = medianoche del día siguiente', () => {
    const slots = generarSlots(ventanasDeJornada('2030-01-04', BA, horarios), 60);
    expect(slots.at(-1)).toEqual({ inicio: local('2030-01-04', '23:00'), fin: local('2030-01-05', '00:00') });
  });

  it('turnos de 90 min: el último entra justo antes del cierre', () => {
    const slots = generarSlots(ventanasDeJornada('2030-01-04', BA, horarios), 90);
    expect(slots.map((s) => s.inicio)).toContainEqual(local('2030-01-04', '22:00'));
    expect(slots).toHaveLength(9); // 10:00, 11:30, … 22:00 (22:00–23:30); 23:30 ya no entra
  });

  it('día sin horario o día especial cerrado → sin turnos', () => {
    expect(ventanasDeJornada('2030-01-06', BA, horarios)).toEqual([]);
    const feriado = { fecha: '2030-01-05', cerrado: true, abre: null, cierra: null };
    expect(ventanasDeJornada('2030-01-05', BA, horarios, feriado)).toEqual([]);
  });

  it('día especial con horario reducido reemplaza al habitual', () => {
    const especial = { fecha: '2030-01-05', cerrado: false, abre: '14:00', cierra: '18:00' };
    expect(generarSlots(ventanasDeJornada('2030-01-05', BA, horarios, especial), 60)).toHaveLength(4);
  });

  it('marca pasados, ocupados (incluso solapes parciales) y libres', () => {
    const slots = generarSlots(
      [{ inicio: local('2030-01-05', '18:00'), fin: local('2030-01-05', '22:00') }],
      60,
    );
    const ocupados = [{ inicio: local('2030-01-05', '20:30'), fin: local('2030-01-05', '21:30') }];
    const ahora = local('2030-01-05', '18:30');
    expect(marcarDisponibilidad(slots, ocupados, ahora).map((s) => s.estado)).toEqual([
      'PASADO',
      'LIBRE',
      'OCUPADO',
      'OCUPADO',
    ]);
  });

  it('turnos contiguos no se consideran ocupados', () => {
    const slots = [{ inicio: local('2030-01-05', '21:00'), fin: local('2030-01-05', '22:00') }];
    const ocupados = [{ inicio: local('2030-01-05', '20:00'), fin: local('2030-01-05', '21:00') }];
    expect(marcarDisponibilidad(slots, ocupados, local('2030-01-01', '00:00'))[0]?.estado).toBe('LIBRE');
  });
});
