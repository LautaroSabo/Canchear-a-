// Alta de un club nuevo con su dueño, para empezar a configurarlo desde el panel:
//   pnpm club:crear <slug> "<Nombre del club>" <email-del-dueño> "<Nombre del dueño>"
// El slug es la dirección pública: tusitio.com/<slug>. La contraseña del dueño se toma de
// CONTRASENA o se genera una y se muestra una sola vez.
import { randomBytes } from 'node:crypto';
import { crearDb, urlDesdeEntorno } from '@cancheria/db';
import { clubs, usuarios } from '@cancheria/db/schema';
import { problemaSlug, ServicioAuth } from '@cancheria/servicios';
import { eq } from 'drizzle-orm';

const USO = 'Uso: pnpm club:crear <slug> "<Nombre del club>" <email-del-dueño> "<Nombre del dueño>"';
const [slug, nombre, email, nombreDueno] = process.argv.slice(2);
if (!slug || !nombre || !email || !nombreDueno) {
  console.error(USO);
  process.exit(1);
}
const problema = problemaSlug(slug);
if (problema) {
  console.error(`✖ Slug "${slug}": ${problema}.`);
  process.exit(1);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('✖ El email del dueño no es válido.');
  process.exit(1);
}

const { db, cerrar } = crearDb(urlDesdeEntorno(), { max: 1 });
const auth = new ServicioAuth({ db, reloj: () => new Date() });
try {
  const [ocupado] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, slug));
  if (ocupado) throw new Error(`Ya existe un club con el slug "${slug}"`);
  const [club] = await db.insert(clubs).values({ slug, nombre }).returning({ id: clubs.id });
  if (!club) throw new Error('No se pudo crear el club');

  const [existente] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, email));
  let generada: string | undefined;
  let usuarioId = existente?.id;
  if (!usuarioId) {
    if (!process.env.CONTRASENA) generada = randomBytes(12).toString('base64url');
    usuarioId = (
      await auth.crearUsuario({
        email,
        nombre: nombreDueno,
        contrasena: process.env.CONTRASENA ?? (generada as string),
      })
    ).id;
  }
  await auth.asignarRol(club.id, usuarioId, 'OWNER');

  console.log(`✔ Club "${nombre}" creado. Página de reservas: /${slug}`);
  console.log(`  Dueño: ${email}${existente ? ' (usuario existente, mantiene su contraseña)' : ''}`);
  if (generada) console.log(`  Contraseña (guardala, no se vuelve a mostrar): ${generada}`);
  console.log(
    '  Siguiente paso: entrar al panel → Configuración y cargar canchas, horarios, tarifas, seña y cobros.',
  );
} catch (e) {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await cerrar();
}
