import { describe, expect, it } from 'vitest';
import {
  fechaCorta,
  fechaLarga,
  fechaLocal,
  hora,
  iniciales,
  instanteLocal,
  pesos,
  proximosDias,
  reloj,
  segundosHasta,
  telefonoLegible,
} from './formato';

const BA = 'America/Argentina/Buenos_Aires';

describe('formato', () => {
  it('pesos con separador de miles argentino', () => {
    expect(pesos(4_500_000)).toBe('$45.000');
    expect(pesos(150)).toBe('$2');
    expect(pesos(123_456_789)).toBe('$1.234.568');
  });

  it('horas y fechas en la zona del club (las 22 locales ya son otro día en UTC)', () => {
    expect(hora('2030-01-06T01:30:00Z', BA)).toBe('22:30');
    expect(fechaLocal('2030-01-06T01:30:00Z', BA)).toBe('2030-01-05');
    expect(hora('2030-01-05T03:00:00Z', BA)).toBe('00:00');
  });

  it('hora local del club → UTC, incluso con horario de verano', () => {
    expect(instanteLocal('2030-01-05', '20:00', BA)).toBe('2030-01-05T23:00:00.000Z');
    expect(instanteLocal('2030-03-31', '12:00', 'Europe/Madrid')).toBe('2030-03-31T10:00:00.000Z');
    expect(instanteLocal('2030-03-30', '12:00', 'Europe/Madrid')).toBe('2030-03-30T11:00:00.000Z');
  });

  it('nombres de días y meses en castellano', () => {
    expect(fechaCorta('2030-01-05')).toBe('Sábado 05/01');
    expect(fechaLarga('2026-10-24')).toBe('Sábado 24 de octubre');
    expect(proximosDias('2030-01-04', 3)).toEqual([
      { fecha: '2030-01-04', nombre: 'Hoy', numero: '04' },
      { fecha: '2030-01-05', nombre: 'Sáb', numero: '05' },
      { fecha: '2030-01-06', nombre: 'Dom', numero: '06' },
    ]);
  });

  it('iniciales del club', () => {
    expect(iniciales('La Canchita F5')).toBe('LC');
    expect(iniciales('Ñandú Fútbol')).toBe('ÑF');
  });

  it('teléfonos y timers', () => {
    expect(telefonoLegible('+5491155551234')).toBe('+54 9 11 5555-1234');
    expect(telefonoLegible('+59899123456')).toBe('+59899123456');
    expect(reloj(125)).toBe('02:05');
    expect(segundosHasta('2030-01-01T00:00:10Z', Date.parse('2030-01-01T00:00:00Z'))).toBe(10);
    expect(segundosHasta('2020-01-01T00:00:00Z')).toBe(0);
  });
});
