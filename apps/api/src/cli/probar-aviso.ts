// Manda un error de prueba al aviso de errores (Sentry) para comprobar que llega.
//   pnpm aviso:prueba
import { iniciarAvisoErrores } from '@cancheria/servicios';

const dsn = process.env.SENTRY_DSN;
if (!dsn) {
  console.error('✖ Falta SENTRY_DSN: cargalo en las variables del servicio (ver docs/errores.md).');
  process.exit(1);
}
const aviso = iniciarAvisoErrores({ dsn, servicio: 'prueba' });
aviso.capturar(new Error('Prueba del aviso de errores de Canchería: si ves esto, funciona.'), {
  origen: 'cli',
});
await aviso.cerrar();
console.log('✓ Mandado. En un minuto tiene que aparecer en Sentry (Issues) y llegarte un mail.');
