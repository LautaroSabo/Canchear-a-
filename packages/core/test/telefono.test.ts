import { describe, expect, it } from 'vitest';
import { normalizarTelefono } from '../src/telefono.ts';

describe('normalizarTelefono', () => {
  it.each([
    '11 5555-1234',
    '011 15 5555-1234',
    '+54 9 11 5555 1234',
    '+5491155551234',
    '+541155551234',
    '(011) 5555-1234',
  ])('%s → +5491155551234 (mismo cliente)', (entrada) => {
    expect(normalizarTelefono(entrada)).toBe('+5491155551234');
  });

  it('interior: 351 15 123-4567 → +5493511234567', () => {
    expect(normalizarTelefono('351 15 123-4567')).toBe('+5493511234567');
  });

  it('extranjeros con prefijo internacional se respetan', () => {
    expect(normalizarTelefono('+598 99 123 456')).toBe('+59899123456');
  });

  it.each(['123', '4555-1234', 'hola', ''])('%j es inválido', (entrada) => {
    expect(normalizarTelefono(entrada)).toBeNull();
  });
});
