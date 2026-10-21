// Alta de un usuario del panel con su rol en un club:
//   pnpm --filter @cancheria/api admin:crear-usuario <email> "<nombre>" <slug-del-club> <OWNER|ADMIN|RECEPCION>
// La contraseña se toma de CONTRASENA o se genera una y se muestra una sola vez.
import { randomBytes } from 'node:crypto';
import { crearDb, urlDesdeEntorno } from '@cancheria/db';
import { clubs, usuarios } from '@cancheria/db/schema';
import { type Rol, ServicioAuth } from '@cancheria/servicios';
import { eq } from 'drizzle-orm';

const [email, nombre, slug, rol] = process.argv.slice(2);
const ROLES = ['OWNER', 'ADMIN', 'RECEPCION'];
if (!email || !nombre || !slug || !rol || !ROLES.includes(rol)) {
  console.error('Uso: admin:crear-usuario <email> "<nombre>" <slug-del-club> <OWNER|ADMIN|RECEPCION>');
  process.exit(1);
}

const { db, cerrar } = crearDb(urlDesdeEntorno(), { max: 1 });
const auth = new ServicioAuth({ db, reloj: () => new Date() });
try {
  const [club] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, slug));
  if (!club) throw new Error(`No existe el club "${slug}"`);

  const [existente] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, email));
  let generada: string | undefined;
  let usuarioId = existente?.id;
  if (!usuarioId) {
    if (!process.env.CONTRASENA) generada = randomBytes(12).toString('base64url');
    const contrasena = process.env.CONTRASENA ?? (generada as string);
    usuarioId = (await auth.crearUsuario({ email, nombre, contrasena })).id;
  }
  await auth.asignarRol(club.id, usuarioId, rol as Rol);
  console.log(`✔ ${email} es ${rol} de ${slug}${existente ? ' (usuario existente)' : ''}`);
  if (generada) console.log(`  Contraseña generada (guardala, no se vuelve a mostrar): ${generada}`);
} catch (e) {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await cerrar();
}
