// Grabación del video de venta (no es un test: se saltea salvo con VIDEO_DIR).
// VIDEO_DIR=/ruta/salida npx playwright test video-demo --trace off
// y después: python3 scripts/video/armar.py /ruta/salida
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API, DUENIO, elegirUltimoSabado, SLUG, ultimoSabado } from './utilidades';

const SALIDA = process.env.VIDEO_DIR as string;

// Un círculo donde se toca, para que se vea en el video.
const TOQUES = `
addEventListener('pointerdown', (e) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:44px;height:44px;border-radius:50%;' +
    'background:rgba(31,122,61,.35);border:2px solid rgba(31,122,61,.9);left:' + (e.clientX - 22) + 'px;top:' + (e.clientY - 22) +
    'px;transition:transform .45s ease-out,opacity .45s ease-out';
  document.documentElement.appendChild(d);
  requestAnimationFrame(() => { d.style.transform = 'scale(1.6)'; d.style.opacity = '0'; });
  setTimeout(() => d.remove(), 600);
}, true);`;

const CHECKOUT = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<body style="margin:0;font-family:system-ui;background:#f5f5f5">
<div style="background:#ffe600;padding:18px 20px;font-weight:700;font-size:18px">mercado pago</div>
<div style="padding:24px 20px;display:flex;flex-direction:column;gap:14px">
<div style="color:#666;font-size:14px">Pago de prueba (simulado para el video)</div>
<div style="background:#fff;border-radius:8px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
<div style="font-size:14px;color:#666">Seña · La Canchita F5</div>
<div style="font-size:32px;font-weight:600;margin-top:4px">$ 22.500</div></div>
<div style="background:#fff;border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.1);font-size:15px">Dinero disponible en Mercado Pago</div>
<button id="pagar" style="background:#009ee3;color:#fff;border:0;border-radius:6px;padding:16px;font-size:17px;font-weight:600">Pagar</button>
</div></body>`;

test('video: reserva del jugador y panel del club', async ({ browser, request }) => {
  test.skip(!SALIDA, 'Solo para grabar el video (VIDEO_DIR)');
  test.setTimeout(180_000);
  const fecha = ultimoSabado();
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Panel del dueño (se loguea antes de empezar a grabar el celular).
  const ctxPanel = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
    recordVideo: { dir: `${SALIDA}/panel`, size: { width: 2560, height: 1720 } },
    timezoneId: 'UTC',
    locale: 'es-AR',
  });
  const inicioPanel = Date.now();
  await ctxPanel.addInitScript(TOQUES);
  const panel = await ctxPanel.newPage();
  await panel.goto('/panel/login');
  await panel.getByLabel('Email').fill(DUENIO.email);
  await panel.getByLabel('Contraseña').fill(DUENIO.contrasena);
  await panel.getByRole('button', { name: 'Entrar' }).click();
  await panel.waitForURL(/\/panel\/[0-9a-f-]{36}\/agenda/);
  const base = panel.url().split('/agenda')[0];
  await panel.goto(`${base}/agenda?fecha=${fecha}`);
  await expect(panel.getByText('Cancha 1').first()).toBeVisible();
  // La grilla arranca a las 9: que se vea la noche, donde va a caer el turno.
  await panel.evaluate(() => {
    const g = document.querySelector<HTMLElement>('[class*="max-h-[calc(100dvh-280px)]"]');
    if (g) g.scrollTop = 8 * 56;
  });
  await espera(1500);

  // Celular del jugador.
  const ctxCel = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    recordVideo: { dir: `${SALIDA}/celular`, size: { width: 780, height: 1688 } },
    timezoneId: 'UTC',
    locale: 'es-AR',
  });
  const inicioCel = Date.now();
  const marcas: { t: number; texto: string }[] = [];
  // Con voz (scripts/video/voz.py deja duraciones.json en VIDEO_DIR): cada paso dura por lo
  // menos lo que tarda su frase, así la voz no se pisa con la siguiente.
  const voz = existsSync(`${SALIDA}/duraciones.json`)
    ? (JSON.parse(readFileSync(`${SALIDA}/duraciones.json`, 'utf8')).pasos as number[])
    : [];
  const ahora = () => (Date.now() - inicioCel) / 1000;
  const terminarFrase = async () => {
    const previa = marcas.at(-1);
    const dur = voz[marcas.length - 1];
    const hasta = previa && dur ? previa.t + dur + 0.4 : 0;
    if (ahora() < hasta) await espera((hasta - ahora()) * 1000);
  };
  const marca = async (texto: string) => {
    await terminarFrase();
    marcas.push({ t: ahora(), texto });
  };
  await ctxCel.addInitScript(TOQUES);
  const cel = await ctxCel.newPage();
  await cel.route('https://mp.test/**', (r) => r.fulfill({ contentType: 'text/html', body: CHECKOUT }));

  await cel.goto(`/${SLUG}`);
  await expect(cel.getByRole('button', { name: /^Cancha 1 \d\d:00/ }).first()).toBeVisible();
  await expect(cel.getByText('Buscando horarios…')).toHaveCount(0);
  await marca('El jugador entra al link del club');
  await espera(2500);
  await elegirUltimoSabado(cel);
  await espera(1200);
  await marca('Elige día, cancha y horario');
  await cel.getByRole('button', { name: 'Cancha 1 21:00, $45.000' }).last().scrollIntoViewIfNeeded();
  await espera(800);
  await cel.getByRole('button', { name: 'Cancha 1 21:00, $45.000' }).last().click();
  await espera(1000);
  await cel.getByRole('button', { name: 'Continuar' }).click();
  await espera(800);
  await marca('Deja su nombre y WhatsApp');
  await cel.getByLabel('Nombre y apellido').pressSequentially('Juan Pérez', { delay: 70 });
  await cel.getByRole('textbox', { name: 'WhatsApp' }).pressSequentially('11 5100-2001', { delay: 60 });
  await cel.getByRole('textbox', { name: /Email/ }).pressSequentially('juan@gmail.com', { delay: 50 });
  await cel.getByRole('checkbox', { name: /Acepto los Términos/ }).check();
  await espera(700);
  await cel.getByRole('button', { name: 'Reservar y pagar la seña' }).click();

  await cel.waitForURL(/\/r\/[0-9a-f]{32}$/);
  const codigo = cel.url().split('/r/')[1];
  await expect(cel.getByRole('heading', { name: 'Falta pagar la seña' })).toBeVisible();
  await marca('El horario queda guardado mientras paga');
  await espera(2500);
  await cel.getByRole('button', { name: /Pagar \$22\.500 con Mercado Pago/ }).click();
  await cel.waitForURL(/mp\.test/);
  await marca('Paga la seña con Mercado Pago');
  await espera(2000);
  await cel.locator('#pagar').click();
  await espera(600);
  await marca('Al club le aparece solo, ya pagado');
  const pago = await (await request.post(`${API}/__e2e/mercadopago/pagar`)).json();
  expect(pago.resultado).toBe('CONFIRMADO');
  await cel.goto(`/r/${codigo}?collection_status=approved`);
  await expect(cel.getByText('¡Turno confirmado!')).toBeVisible();
  await espera(1200);
  await panel
    .getByRole('button', { name: /Juan Pérez/ })
    .first()
    .click();
  await espera(2300);
  await marca('Comprobante con QR para entrar a la cancha');
  await cel.getByRole('img', { name: 'Código QR de la reserva' }).scrollIntoViewIfNeeded();
  await espera(3500);
  await marca('Sin contestar un solo WhatsApp');
  await espera(1500);
  await terminarFrase();
  await espera(1000);
  const fin = (Date.now() - inicioCel) / 1000;

  await ctxCel.close();
  await ctxPanel.close();
  writeFileSync(
    `${SALIDA}/marcas.json`,
    JSON.stringify({ desfasePanel: (inicioCel - inicioPanel) / 1000, fin, marcas }, null, 2),
  );
});
