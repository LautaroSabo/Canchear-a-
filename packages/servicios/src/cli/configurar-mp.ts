// Carga (cifradas) las credenciales de Mercado Pago de un club. Mientras no exista el
// panel de admin: pnpm --filter @cancheria/servicios mp:configurar <slug> <access_token> [webhook_secret]
import { crearDb, urlDesdeEntorno } from '@cancheria/db';
import { clubs } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';
import { Cifrador } from '../cifrado.ts';
import { guardarCredencialesMp } from '../credenciales.ts';

const [slug, accessToken, webhookSecret] = process.argv.slice(2);
if (!slug || !accessToken) {
  console.error('Uso: mp:configurar <slug> <access_token> [webhook_secret]');
  process.exit(1);
}
const clave = process.env.CLAVE_CREDENCIALES;
if (!clave) {
  console.error(`Falta CLAVE_CREDENCIALES. Generá una con:\n  CLAVE_CREDENCIALES=${Cifrador.generarClave()}`);
  process.exit(1);
}

const { db, cerrar } = crearDb(urlDesdeEntorno(), { max: 1 });
try {
  const [club] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, slug));
  if (!club) throw new Error(`No existe el club "${slug}"`);
  await guardarCredencialesMp(db, new Cifrador(clave), club.id, {
    accessToken,
    ...(webhookSecret ? { webhookSecret } : {}),
  });
  console.log(`✔ Credenciales de Mercado Pago guardadas para ${slug}`);
} finally {
  await cerrar();
}
