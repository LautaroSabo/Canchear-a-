import { createHmac, randomBytes } from 'node:crypto';

// TOTP (RFC 6238) con HMAC-SHA1, 6 dígitos y pasos de 30 s: lo que usan Google
// Authenticator, Authy, Microsoft Authenticator, 1Password, etc.

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PASO_SEGUNDOS = 30;

export function base32(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

export function desdeBase32(texto: string): Buffer {
  const limpio = texto.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of limpio) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error('base32 inválido');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo de 160 bits, en base32. */
export const nuevoSecretoTotp = () => base32(randomBytes(20));

export const pasoDe = (instante: Date) => Math.floor(instante.getTime() / 1000 / PASO_SEGUNDOS);

export function codigoTotp(secreto: string, paso: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const h = createHmac('sha1', desdeBase32(secreto)).update(contador).digest();
  const desplazamiento = (h[h.length - 1] as number) & 0xf;
  const n = (h.readUInt32BE(desplazamiento) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, '0');
}

/**
 * Paso en el que vale `codigo` (acepta un paso antes y uno después, por relojes un poco
 * corridos), o null. Pasos ya usados (`<= ultimoUsado`) no valen: un código no se reusa.
 */
export function verificarTotp(secreto: string, codigo: string, ahora: Date, ultimoUsado: number | null) {
  const limpio = codigo.replace(/\s/g, '');
  if (!/^\d{6}$/.test(limpio)) return null;
  const actual = pasoDe(ahora);
  for (const paso of [actual - 1, actual, actual + 1]) {
    if (ultimoUsado !== null && paso <= ultimoUsado) continue;
    if (codigoTotp(secreto, paso) === limpio) return paso;
  }
  return null;
}

/** Link que se muestra como QR para agregar la cuenta a la app autenticadora. */
export const uriTotp = (secreto: string, email: string, emisor = 'Canchería') =>
  `otpauth://totp/${encodeURIComponent(`${emisor}:${email}`)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=${PASO_SEGUNDOS}`;
