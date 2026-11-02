// Marca a alguien como administrador de la plataforma (aprueba clubes, registra abonos):
//   pnpm superadmin <email> ["<Nombre>"]
// Si el email no tiene cuenta, la crea; la contraseña se toma de CONTRASENA o se genera
// una y se muestra una sola vez.
import { randomBytes } from 'node:crypto';
import { crearDb, urlDesdeEntorno } from '@cancheria/db';
import { ServicioAuth, ServicioPlataforma } from '@cancheria/servicios';

const [email, nombre = 'Administración'] = process.argv.slice(2);
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Uso: pnpm superadmin <email> ["<Nombre>"]');
  process.exit(1);
}

const { db, cerrar } = crearDb(urlDesdeEntorno(), { max: 1 });
const entorno = { db, reloj: () => new Date() };
const plataforma = new ServicioPlataforma(entorno);
try {
  let generada: string | undefined;
  if (!(await plataforma.hacerSuperadmin(email))) {
    if (!process.env.CONTRASENA) generada = randomBytes(12).toString('base64url');
    await new ServicioAuth(entorno).crearUsuario({
      email,
      nombre,
      contrasena: process.env.CONTRASENA ?? (generada as string),
    });
    await plataforma.hacerSuperadmin(email);
  }
  console.log(`✔ ${email} administra la plataforma. Entrá al panel: /panel/plataforma`);
  if (generada) console.log(`  Contraseña (guardala, no se vuelve a mostrar): ${generada}`);
} catch (e) {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await cerrar();
}
