// Servidor SOLO para los tests end-to-end del front (apps/web/e2e): base temporal con
// el club demo, un usuario dueño y Mercado Pago falso. Agrega un endpoint que simula
// que el cliente pagó el último checkout (dispara el webhook firmado real).
// Nunca se usa en producción: el server real es src/server.ts.
import { crearClubDemo, crearDb } from '@cancheria/db';
import { crearBaseDeTest } from '@cancheria/db/testing';
import { Cifrador, guardarCredencialesMp, ServicioAuth } from '@cancheria/servicios';
import { AlmacenMemoria, firmarWebhook, PasarelaMpFalsa } from '@cancheria/servicios/testing';
import { construirApp } from './app.ts';
import { cargarConfig } from './config.ts';

export const E2E = { email: 'duenio@e2e.test', contrasena: 'contrasena-e2e', slug: 'la-canchita' };
const SECRETO = 'secreto-webhook-e2e';

const base = await crearBaseDeTest('cancheria_e2e');
const config = {
  ...cargarConfig({
    ...process.env,
    DATABASE_URL: base.url,
    NODE_ENV: 'test',
    CLAVE_CREDENCIALES: Cifrador.generarClave(),
  }),
  reservasPorMinuto: 10_000,
  loginsPorMinuto: 10_000,
};
const { db, cliente, cerrar } = crearDb(base.url, { max: 10 });
const { club } = await crearClubDemo(db, E2E.slug);
await guardarCredencialesMp(db, new Cifrador(config.claveCredenciales), club.id, {
  accessToken: 'TEST-e2e',
  webhookSecret: SECRETO,
});
const auth = new ServicioAuth({ db, reloj: () => new Date() });
const duenio = await auth.crearUsuario({ email: E2E.email, nombre: 'Dueño E2E', contrasena: E2E.contrasena });
await auth.asignarRol(club.id, duenio.id, 'OWNER');

const pasarela = new PasarelaMpFalsa();
const app = await construirApp({
  db,
  cliente,
  config,
  logger: false,
  pasarela,
  almacen: new AlmacenMemoria(),
});

app.post('/__e2e/mercadopago/pagar', async () => {
  const pref = [...pasarela.preferencias.values()].at(-1);
  if (!pref) throw new Error('no hay ningún checkout de Mercado Pago');
  const pago = pasarela.pagar(pref.referenciaExterna, pref.monto);
  const res = await app.inject({
    method: 'POST',
    url: `/webhooks/mercadopago/${E2E.slug}?data.id=${pago.id}&type=payment`,
    headers: { 'x-request-id': 'e2e', 'x-signature': firmarWebhook(SECRETO, pago.id, 'e2e') },
  });
  return res.json();
});

const apagar = async () => {
  await app.close();
  await cerrar();
  await base.borrar();
  process.exit(0);
};
process.once('SIGTERM', () => void apagar());
process.once('SIGINT', () => void apagar());

await app.listen({ port: config.puerto, host: '127.0.0.1' });
console.log(`API e2e lista en :${config.puerto}`);
