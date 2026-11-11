// Quita la verificación en dos pasos de un usuario que perdió el celular y los códigos de
// recuperación (entra solo con la contraseña y la puede volver a activar):
//   pnpm usuario:sin-dos-pasos <email>
// Antes de usarlo, confirmá por otro medio que quien lo pide es el dueño de la cuenta.
import { crearDb, urlDesdeEntorno } from '@cancheria/db';
import { sesiones, usuarios } from '@cancheria/db/schema';
import { eq } from 'drizzle-orm';

const [email] = process.argv.slice(2);
if (!email) {
  console.error('Uso: pnpm usuario:sin-dos-pasos <email>');
  process.exit(1);
}
const { db, cerrar } = crearDb(urlDesdeEntorno(), { max: 1 });
try {
  const [u] = await db
    .update(usuarios)
    .set({ totpSecreto: null, totpActivoDesde: null, totpUltimoPaso: null, codigosRecuperacion: [] })
    .where(eq(usuarios.email, email.trim().toLowerCase()))
    .returning({ id: usuarios.id });
  if (!u) throw new Error(`No hay ningún usuario con el email ${email}`);
  await db.delete(sesiones).where(eq(sesiones.usuarioId, u.id));
  console.log(`✔ Se quitó la verificación en dos pasos de ${email}. Entra solo con su contraseña.`);
} catch (e) {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await cerrar();
}
