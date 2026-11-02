// Contraseña nueva para un usuario que se la olvidó (cierra todas sus sesiones):
//   pnpm usuario:contrasena <email>
// La contraseña se toma de CONTRASENA o se genera una y se muestra una sola vez.
import { randomBytes } from 'node:crypto';
import { crearDb, urlDesdeEntorno } from '@cancheria/db';
import { sesiones, usuarios } from '@cancheria/db/schema';
import { hashContrasena, LARGO_MINIMO_CONTRASENA } from '@cancheria/servicios';
import { eq } from 'drizzle-orm';

const [email] = process.argv.slice(2);
if (!email) {
  console.error('Uso: pnpm usuario:contrasena <email>');
  process.exit(1);
}
const generada = process.env.CONTRASENA ? undefined : randomBytes(12).toString('base64url');
const nueva = process.env.CONTRASENA ?? (generada as string);
if (nueva.length < LARGO_MINIMO_CONTRASENA) {
  console.error(`✖ La contraseña tiene que tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres.`);
  process.exit(1);
}

const { db, cerrar } = crearDb(urlDesdeEntorno(), { max: 1 });
try {
  const [u] = await db
    .update(usuarios)
    .set({ passwordHash: await hashContrasena(nueva) })
    .where(eq(usuarios.email, email.trim().toLowerCase()))
    .returning({ id: usuarios.id });
  if (!u) throw new Error(`No hay ningún usuario con el email ${email}`);
  await db.delete(sesiones).where(eq(sesiones.usuarioId, u.id));
  console.log(`✔ Contraseña cambiada para ${email}. Se cerraron sus sesiones abiertas.`);
  if (generada) console.log(`  Contraseña nueva (pasásela por un canal privado): ${generada}`);
} catch (e) {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await cerrar();
}
