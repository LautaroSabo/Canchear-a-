import { describe, expect, it } from 'vitest';
import { resolverTarifa, type Tarifa } from '../src/precios.ts';
import { calcularExpiracion, calcularSena, type ReglaSena, resolverRegla } from '../src/sena.ts';

const t = (hhmm: string, extra: Partial<{ diaSemana: number; canchaId: string; fecha: string }> = {}) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return { canchaId: 'c1', diaSemana: 6, minutoInicio: h * 60 + m, fecha: '2030-01-05', ...extra };
};

const tarifa = (x: Partial<Tarifa>): Tarifa => ({
  canchaId: null,
  diaSemana: null,
  horaDesde: '00:00',
  horaHasta: '00:00',
  precio: 0,
  vigenteDesde: '2020-01-01',
  vigenteHasta: null,
  ...x,
});

describe('resolverTarifa', () => {
  const tarifas = [
    tarifa({ horaDesde: '00:00', horaHasta: '18:00', precio: 30 }),
    tarifa({ horaDesde: '18:00', horaHasta: '00:00', precio: 45 }),
    tarifa({ canchaId: 'c3', horaDesde: '18:00', horaHasta: '00:00', precio: 70 }),
    tarifa({ diaSemana: 0, horaDesde: '18:00', horaHasta: '00:00', precio: 40 }),
  ];

  it('pico / valle según la hora de inicio', () => {
    expect(resolverTarifa(tarifas, t('17:00'))?.precio).toBe(30);
    expect(resolverTarifa(tarifas, t('18:00'))?.precio).toBe(45);
    expect(resolverTarifa(tarifas, t('23:00'))?.precio).toBe(45);
  });

  it('la tarifa de la cancha gana a la general, la del día a la de todos los días', () => {
    expect(resolverTarifa(tarifas, t('20:00', { canchaId: 'c3' }))?.precio).toBe(70);
    expect(resolverTarifa(tarifas, t('20:00', { diaSemana: 0 }))?.precio).toBe(40);
  });

  it('respeta la vigencia y prefiere la más reciente (aumento de precios)', () => {
    const conAumento = [
      ...tarifas,
      tarifa({ horaDesde: '18:00', horaHasta: '00:00', precio: 50, vigenteDesde: '2030-01-01' }),
    ];
    expect(resolverTarifa(conAumento, t('20:00'))?.precio).toBe(50);
    expect(resolverTarifa(conAumento, t('20:00', { fecha: '2029-12-31' }))?.precio).toBe(45);
  });

  it('sin tarifa que cubra el horario → null', () => {
    expect(
      resolverTarifa([tarifa({ horaDesde: '10:00', horaHasta: '12:00', precio: 1 })], t('20:00')),
    ).toBeNull();
  });
});

const regla = (x: Partial<ReglaSena>): ReglaSena => ({
  canchaId: null,
  diaSemana: null,
  horaDesde: null,
  horaHasta: null,
  requiereSena: true,
  tipoSena: 'PORCENTAJE',
  valorSena: 50,
  minutosExpiracion: 30,
  margenMinAntesInicio: 15,
  prioridad: 0,
  activa: true,
  ...x,
});

describe('resolverRegla (config del seed)', () => {
  const reglas = [
    regla({ minutosExpiracion: 30 }),
    regla({ diaSemana: 6, minutosExpiracion: 10 }),
    regla({ diaSemana: 2, horaDesde: '13:00', horaHasta: '17:00', requiereSena: false }),
  ];

  it('general entre semana, más corta el sábado, sin seña en la siesta', () => {
    expect(resolverRegla(reglas, t('20:00', { diaSemana: 2 }))?.minutosExpiracion).toBe(30);
    expect(resolverRegla(reglas, t('20:00'))?.minutosExpiracion).toBe(10);
    expect(resolverRegla(reglas, t('14:00', { diaSemana: 2 }))?.requiereSena).toBe(false);
  });

  it('la prioridad manda sobre la especificidad; las inactivas no cuentan', () => {
    const conPromo = [...reglas, regla({ prioridad: 10, requiereSena: false })];
    expect(resolverRegla(conPromo, t('20:00'))?.requiereSena).toBe(false);
    const inactiva = [...reglas, regla({ prioridad: 10, requiereSena: false, activa: false })];
    expect(resolverRegla(inactiva, t('20:00'))?.requiereSena).toBe(true);
  });

  it('a igual prioridad, la regla de la cancha gana a la del día', () => {
    expect(
      resolverRegla([...reglas, regla({ canchaId: 'c1', minutosExpiracion: 5 })], t('20:00'))
        ?.minutosExpiracion,
    ).toBe(5);
  });
});

describe('calcularSena / calcularExpiracion', () => {
  it('porcentaje redondeado, monto fijo con tope en el precio, sin regla = 0', () => {
    expect(calcularSena(4_500_001, regla({}))).toBe(2_250_001);
    expect(calcularSena(1_000, regla({ tipoSena: 'MONTO_FIJO', valorSena: 5_000 }))).toBe(1_000);
    expect(calcularSena(1_000, null)).toBe(0);
    expect(calcularSena(1_000, regla({ requiereSena: false }))).toBe(0);
  });

  const ahora = new Date('2030-01-05T15:00:00Z');
  const enMin = (m: number) => new Date(ahora.getTime() + m * 60_000);

  it('usa el timer si el turno está lejos', () => {
    expect(calcularExpiracion(ahora, enMin(600), regla({}), 100)).toEqual({
      tipo: 'HOLD',
      expiraEn: enMin(30),
    });
  });

  it('nunca vence después de (inicio − margen)', () => {
    expect(calcularExpiracion(ahora, enMin(35), regla({}), 100)).toEqual({
      tipo: 'HOLD',
      expiraEn: enMin(20),
    });
  });

  it('turno inminente → MUY_CERCA; sin seña → SIN_SENA', () => {
    expect(calcularExpiracion(ahora, enMin(17), regla({}), 100)).toEqual({ tipo: 'MUY_CERCA' });
    expect(calcularExpiracion(ahora, enMin(17), regla({ requiereSena: false }), 0)).toEqual({
      tipo: 'SIN_SENA',
    });
    expect(calcularExpiracion(ahora, enMin(600), regla({}), 0)).toEqual({ tipo: 'SIN_SENA' });
  });
});
