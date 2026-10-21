import { notificaciones } from '@cancheria/db/schema';
import type { Ejecutor } from '../entorno.ts';
import type { Plantilla } from './plantillas.ts';

export interface NuevaNotificacion {
  clubId: string;
  clienteId: string | null;
  destino: string;
  plantilla: Plantilla;
  parametros: Record<string, string>;
}

/**
 * Patrón outbox: se llama dentro de la misma transacción que el cambio de negocio, así
 * el mensaje existe si y solo si el cambio hizo COMMIT. El worker lo despacha después.
 */
export async function encolarNotificacion(tx: Ejecutor, n: NuevaNotificacion) {
  await tx.insert(notificaciones).values({
    clubId: n.clubId,
    clienteId: n.clienteId,
    canal: 'WHATSAPP',
    destino: n.destino,
    plantilla: n.plantilla,
    payload: n.parametros,
  });
}
