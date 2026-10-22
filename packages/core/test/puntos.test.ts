import { describe, expect, it } from 'vitest';
import { calcularPuntos, descuentoDePremio, type PromocionPuntos } from '../src/puntos.ts';

const promo = (x: Partial<PromocionPuntos>): PromocionPuntos => ({
  id: 'p',
  diaSemana: null,
  horaDesde: null,
  horaHasta: null,
  multiplicador: 2,
  puntosExtra: 0,
  vigenteDesde: '2030-01-01',
  vigenteHasta: null,
  activa: true,
  ...x,
});
const martes15 = { diaSemana: 2, minutoInicio: 15 * 60, fecha: '2030-01-08' };

describe('calcularPuntos', () => {
  it('base sin promociones; base 0 = sin fidelización', () => {
    expect(calcularPuntos(10, [], martes15)).toEqual({ puntos: 10, promocionId: null });
    expect(calcularPuntos(0, [promo({})], martes15)).toEqual({ puntos: 0, promocionId: null });
  });

  it('aplica la promo del día y franja, y gana la que más da', () => {
    const promos = [
      promo({ id: 'valle', diaSemana: 2, horaDesde: '10:00', horaHasta: '17:00', multiplicador: 2 }),
      promo({ id: 'extra', puntosExtra: 5, multiplicador: 1 }),
    ];
    expect(calcularPuntos(10, promos, martes15)).toEqual({ puntos: 20, promocionId: 'valle' });
    expect(calcularPuntos(10, promos, { ...martes15, minutoInicio: 20 * 60 })).toEqual({
      puntos: 15,
      promocionId: 'extra',
    });
  });

  it('respeta vigencia, días y pausadas; franja que cruza medianoche', () => {
    expect(calcularPuntos(10, [promo({ vigenteHasta: '2030-01-07' })], martes15).promocionId).toBeNull();
    expect(calcularPuntos(10, [promo({ diaSemana: 3 })], martes15).promocionId).toBeNull();
    expect(calcularPuntos(10, [promo({ activa: false })], martes15).promocionId).toBeNull();
    const noche = promo({ horaDesde: '22:00', horaHasta: '02:00', multiplicador: 1.5 });
    expect(calcularPuntos(10, [noche], { ...martes15, minutoInicio: 60 })).toEqual({
      puntos: 15,
      promocionId: 'p',
    });
  });
});

describe('descuentoDePremio', () => {
  it('turno gratis, porcentaje y monto (nunca más que el turno)', () => {
    expect(descuentoDePremio({ tipo: 'TURNO_GRATIS', valor: 0 }, 3_000_000)).toBe(3_000_000);
    expect(descuentoDePremio({ tipo: 'DESCUENTO_PORCENTAJE', valor: 20 }, 4_500_000)).toBe(900_000);
    expect(descuentoDePremio({ tipo: 'DESCUENTO_MONTO', valor: 9_000_000 }, 4_500_000)).toBe(4_500_000);
    expect(descuentoDePremio({ tipo: 'PRODUCTO', valor: 0 }, 4_500_000)).toBe(0);
  });
});
