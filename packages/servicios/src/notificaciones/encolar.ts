import { notificaciones } from '@cancheria/db/schema';
import type { Ejecutor } from '../entorno.ts';
import { CANAL_DE, type Plantilla } from './plantillas.ts';

export interface NuevaNotificacion {
  clubId: string;
  clienteId: string | null;
  /** Teléfono E.164 y email del cliente; cada aviso usa el de su canal. */
  telefono: string | null;
  email: string | null;
  plantilla: Plantilla;
  parametros: Record<string, string>;
}

/**
 * Patrón outbox: se llama dentro de la misma transacción que el cambio de negocio, así
 * el mensaje existe si y solo si el cambio hizo COMMIT. El worker lo despacha después.
 * Si el cliente no tiene el dato del canal (por ejemplo, no dejó email), no se encola:
 * todo lo que dice el aviso está también en el link de su reserva.
 */
export async function encolarNotificacion(tx: Ejecutor, n: NuevaNotificacion): Promise<boolean> {
  const canal = CANAL_DE[n.plantilla];
  const destino = canal === 'EMAIL' ? n.email : n.telefono;
  if (!destino) return false;
  await tx.insert(notificaciones).values({
    clubId: n.clubId,
    clienteId: n.clienteId,
    canal,
    destino,
    plantilla: n.plantilla,
    payload: n.parametros,
  });
  return true;
}
