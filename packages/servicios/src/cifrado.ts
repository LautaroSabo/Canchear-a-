import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM para secretos guardados en la base (credenciales de Mercado Pago de cada
 * club). Formato: iv (12 bytes) | tag (16 bytes) | texto cifrado. La clave vive solo en
 * el entorno (CLAVE_CREDENCIALES, 32 bytes en base64), nunca en la base.
 */
export class Cifrador {
  private readonly clave: Buffer;

  constructor(claveBase64: string) {
    this.clave = Buffer.from(claveBase64, 'base64');
    if (this.clave.length !== 32) throw new Error('CLAVE_CREDENCIALES debe ser de 32 bytes en base64');
  }

  static generarClave(): string {
    return randomBytes(32).toString('base64');
  }

  cifrar(valor: unknown): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.clave, iv);
    const datos = Buffer.concat([cipher.update(JSON.stringify(valor), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), datos]);
  }

  descifrar<T>(buffer: Buffer): T {
    const decipher = createDecipheriv('aes-256-gcm', this.clave, buffer.subarray(0, 12));
    decipher.setAuthTag(buffer.subarray(12, 28));
    const texto = Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
    return JSON.parse(texto) as T;
  }
}
