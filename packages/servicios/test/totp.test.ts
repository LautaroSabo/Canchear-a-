import { describe, expect, it } from 'vitest';
import { base32, codigoTotp, desdeBase32, pasoDe, uriTotp, verificarTotp } from '../src/totp.ts';

// Vectores de prueba del RFC 6238 (SHA1, secreto "12345678901234567890"), últimos 6 dígitos.
const SECRETO = base32(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('cumple los vectores del RFC 6238', () => {
    expect(codigoTotp(SECRETO, pasoDe(new Date(59_000)))).toBe('287082');
    expect(codigoTotp(SECRETO, pasoDe(new Date(1_111_111_109_000)))).toBe('081804');
    expect(codigoTotp(SECRETO, pasoDe(new Date(1_234_567_890_000)))).toBe('005924');
    expect(codigoTotp(SECRETO, pasoDe(new Date(2_000_000_000_000)))).toBe('279037');
  });

  it('base32 va y vuelve', () => {
    expect(desdeBase32(base32(Buffer.from('hola mundo'))).toString()).toBe('hola mundo');
  });

  it('acepta un paso de diferencia, no reusa un código y rechaza basura', () => {
    const ahora = new Date(1_700_000_000_000);
    const paso = pasoDe(ahora);
    expect(verificarTotp(SECRETO, codigoTotp(SECRETO, paso), ahora, null)).toBe(paso);
    expect(verificarTotp(SECRETO, codigoTotp(SECRETO, paso - 1), ahora, null)).toBe(paso - 1);
    expect(verificarTotp(SECRETO, codigoTotp(SECRETO, paso - 2), ahora, null)).toBeNull();
    expect(verificarTotp(SECRETO, codigoTotp(SECRETO, paso), ahora, paso)).toBeNull();
    expect(verificarTotp(SECRETO, '12345', ahora, null)).toBeNull();
    expect(
      verificarTotp(
        SECRETO,
        `${codigoTotp(SECRETO, paso).slice(0, 3)} ${codigoTotp(SECRETO, paso).slice(3)}`,
        ahora,
        null,
      ),
    ).toBe(paso);
  });

  it('arma el link para el QR', () => {
    expect(uriTotp('ABC', 'ana@club.test')).toBe(
      'otpauth://totp/Cancher%C3%ADa%3Aana%40club.test?secret=ABC&issuer=Cancher%C3%ADa&algorithm=SHA1&digits=6&period=30',
    );
  });
});
