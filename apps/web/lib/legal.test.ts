import { describe, expect, it } from 'vitest';
import { VERSION_TERMINOS as deLaApi } from '../../../packages/core/src/legal';
import { VERSION_TERMINOS } from './legal';

describe('versión de los términos', () => {
  it('la web muestra la misma fecha que guarda la API', () => {
    expect(VERSION_TERMINOS).toBe(deLaApi);
  });
});
