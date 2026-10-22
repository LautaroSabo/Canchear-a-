// Solo desarrollo: deja un usuario dueño del club demo con contraseña conocida, para
// entrar al panel sin pasos extra. Idempotente.
//   pnpm demo:preparar   (migra, siembra el club demo y crea este usuario)
import { crearDb, urlDesdeEntorno } from '@cancheria/db';
import { clubs, usuarios } from '@cancheria/db/schema';
import { ServicioAuth } from '@cancheria/servicios';
import { eq } from 'drizzle-orm';

export const USUARIO_DEMO = {
  email: 'demo@cancheria.local',
  nombre: 'Dueño demo',
  contrasena: 'demo-cancheria',
};

if (process.env.NODE_ENV === 'production') {
  console.error('✖ demo:preparar está deshabilitado en producción');
  process.exit(1);
}

const { db, cerrar } = crearDb(urlDesdeEntorno(), { max: 1 });
try {
  const auth = new ServicioAuth({ db, reloj: () => new Date() });
  const [club] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, 'la-canchita'));
  if (!club) throw new Error('No existe el club demo: corré pnpm db:seed');
  const [existente] = await db
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(eq(usuarios.email, USUARIO_DEMO.email));
  const id = existente?.id ?? (await auth.crearUsuario(USUARIO_DEMO)).id;
  await auth.asignarRol(club.id, id, 'OWNER');
  console.log(`
✔ Listo para probar
  Página del club:  http://localhost:3000/la-canchita
  Panel:            http://localhost:3000/panel
  Usuario:          ${USUARIO_DEMO.email}
  Contraseña:       ${USUARIO_DEMO.contrasena}

  Levantá todo con:  pnpm dev
`);
} catch (e) {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await cerrar();
}
