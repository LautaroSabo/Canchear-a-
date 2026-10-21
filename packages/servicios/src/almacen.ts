import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/** Dónde se guardan los comprobantes. En producción: S3 / Cloudflare R2 (misma interfaz). */
export interface AlmacenArchivos {
  guardar(clave: string, datos: Buffer, tipo: string): Promise<void>;
  leer(clave: string): Promise<Buffer | null>;
  borrar(clave: string): Promise<void>;
}

/** Disco local (desarrollo). */
export class AlmacenLocal implements AlmacenArchivos {
  private readonly raiz: string;

  constructor(dir: string) {
    this.raiz = resolve(dir);
  }

  private ruta(clave: string) {
    const ruta = resolve(join(this.raiz, clave));
    if (!ruta.startsWith(this.raiz + sep)) throw new Error(`clave fuera del almacén: ${clave}`);
    return ruta;
  }

  async guardar(clave: string, datos: Buffer) {
    const ruta = this.ruta(clave);
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, datos, { flag: 'wx' });
  }

  async leer(clave: string) {
    return readFile(this.ruta(clave)).catch(() => null);
  }

  async borrar(clave: string) {
    await rm(this.ruta(clave), { force: true });
  }
}

/** En memoria (tests). */
export class AlmacenMemoria implements AlmacenArchivos {
  readonly archivos = new Map<string, { datos: Buffer; tipo: string }>();
  async guardar(clave: string, datos: Buffer, tipo: string) {
    this.archivos.set(clave, { datos, tipo });
  }
  async leer(clave: string) {
    return this.archivos.get(clave)?.datos ?? null;
  }
  async borrar(clave: string) {
    this.archivos.delete(clave);
  }
}

export const TAMANO_MAXIMO_COMPROBANTE = 5 * 1024 * 1024;

/**
 * Tipo real del comprobante por sus primeros bytes: no se confía en el nombre ni en el
 * content-type que manda el navegador. Solo JPG, PNG, WEBP y PDF.
 */
export function detectarTipoComprobante(b: Buffer): { mime: string; extension: string } | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { mime: 'image/jpeg', extension: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' };
  }
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', extension: 'pdf' };
  return null;
}
