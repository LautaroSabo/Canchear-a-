import { describe, expect, it } from 'vitest';
import { diaSemana, enFranja, instanteLocal, partesLocales, sumarDias } from '../src/tiempo.ts';

const BA = 'America/Argentina/Buenos_Aires';

describe('zona horaria', () => {
  it('convierte hora local del club a UTC y vuelve', () => {
    const t = instanteLocal('2030-01-05', '20:00', BA);
    expect(t.toISOString()).toBe('2030-01-05T23:00:00.000Z');
    expect(partesLocales(t, BA)).toEqual({ fecha: '2030-01-05', hora: '20:00', diaSemana: 6, minutos: 1200 });
  });

  it('las 22:00 locales ya son el día siguiente en UTC, pero la fecha local se conserva', () => {
    const t = instanteLocal('2030-01-05', '22:30', BA);
    expect(t.toISOString()).toBe('2030-01-06T01:30:00.000Z');
    expect(partesLocales(t, BA).fecha).toBe('2030-01-05');
  });

  it('respeta los cambios de horario de verano (Madrid, último domingo de marzo)', () => {
    expect(instanteLocal('2030-03-30', '12:00', 'Europe/Madrid').toISOString()).toBe(
      '2030-03-30T11:00:00.000Z',
    );
    expect(instanteLocal('2030-03-31', '12:00', 'Europe/Madrid').toISOString()).toBe(
      '2030-03-31T10:00:00.000Z',
    );
  });

  it('acepta horas con segundos (formato time de Postgres)', () => {
    expect(instanteLocal('2030-01-05', '20:00:00', BA).toISOString()).toBe('2030-01-05T23:00:00.000Z');
  });

  it('sumarDias cruza meses y años; diaSemana usa 0 = domingo', () => {
    expect(sumarDias('2030-12-31', 1)).toBe('2031-01-01');
    expect(sumarDias('2030-03-01', -1)).toBe('2030-02-28');
    expect(diaSemana('2030-01-06')).toBe(0);
  });

  it('enFranja: normal, hasta medianoche y cruzando medianoche', () => {
    expect(enFranja('18:00', '00:00', 23 * 60 + 59)).toBe(true);
    expect(enFranja('18:00', '00:00', 17 * 60)).toBe(false);
    expect(enFranja('10:00', '18:00', 18 * 60)).toBe(false); // [desde, hasta)
    expect(enFranja('22:00', '02:00', 1 * 60)).toBe(true);
    expect(enFranja('22:00', '02:00', 12 * 60)).toBe(false);
  });
});
