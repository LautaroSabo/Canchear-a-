import type { Db, Tx } from '@cancheria/db';

export type Reloj = () => Date;

/** Db o transacción en curso: las funciones que reciben esto no abren transacciones propias. */
export type Ejecutor = Db | Tx;

export interface Entorno {
  db: Db;
  reloj: Reloj;
  /** URL pública del front (links del comprobante en los mensajes). */
  urlWeb: string;
}

export const linkComprobante = (urlWeb: string, codigo: string) => `${urlWeb.replace(/\/$/, '')}/r/${codigo}`;
