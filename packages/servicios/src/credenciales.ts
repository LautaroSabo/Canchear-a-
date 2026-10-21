import type { Db } from '@cancheria/db';
import { clubs } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import type { Cifrador } from './cifrado.ts';

export interface CredencialesMp {
  /** Access token de producción (o de prueba) de la cuenta de Mercado Pago del club. */
  accessToken: string;
  /** Clave secreta de webhooks (panel de desarrolladores de MP → Webhooks). */
  webhookSecret?: string;
}

export async function guardarCredencialesMp(
  db: Db,
  cifrador: Cifrador,
  clubId: string,
  cred: CredencialesMp,
) {
  await db
    .update(clubs)
    .set({ mpCredencialesCifradas: cifrador.cifrar(cred) })
    .where(eq(clubs.id, clubId));
}

export async function leerCredencialesMp(
  db: Db,
  cifrador: Cifrador,
  clubId: string,
): Promise<CredencialesMp | null> {
  const [fila] = await db
    .select({ cifradas: clubs.mpCredencialesCifradas })
    .from(clubs)
    .where(eq(clubs.id, clubId));
  return fila?.cifradas ? cifrador.descifrar<CredencialesMp>(fila.cifradas) : null;
}
