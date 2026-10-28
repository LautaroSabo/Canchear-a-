import { expect, test } from '@playwright/test';
import { API, elegirUltimoSabado, PNG, reservarPorApi, SLUG, ultimoSabado } from './utilidades';

test('reserva con seña, pago por Mercado Pago y comprobante con QR', async ({ page, request }) => {
  await page.goto(`/${SLUG}`);
  await expect(page).toHaveTitle(/Reservá en La Canchita F5/);
  await elegirUltimoSabado(page);

  await page.getByRole('button', { name: 'Cancha 1 21:00, $45.000' }).first().click();
  await expect(page.getByText('Seña para reservar')).toBeVisible();
  await page.getByLabel('Nombre y apellido').fill('Juana Pérez');
  await page.getByRole('textbox', { name: 'WhatsApp' }).fill('11 5100-2001');
  await page.getByRole('button', { name: 'Reservar y pagar la seña' }).click();

  await page.waitForURL(/\/r\/[0-9a-f]{32}$/);
  const codigo = page.url().split('/r/')[1] as string;
  await expect(page.getByRole('heading', { name: 'Falta pagar la seña' })).toBeVisible();
  await expect(page.getByText(/^\d\d:\d\d$/)).toBeVisible(); // el timer
  // El navegador está en UTC: la hora tiene que verse en la zona del club.
  await expect(page.getByText(/21:00 a 22:00/)).toBeVisible();

  // Checkout de MP (falso en e2e): la redirección sale hacia afuera del sitio.
  await page.route('https://mp.test/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<h1>Checkout de prueba</h1>' }),
  );
  await page.getByRole('button', { name: 'Pagar $22.500 con Mercado Pago' }).click();
  await page.waitForURL(/mp\.test\/checkout/);

  // El cliente paga y MP manda el webhook firmado; vuelve al comprobante.
  const pago = await (await request.post(`${API}/__e2e/mercadopago/pagar`)).json();
  expect(pago.resultado).toBe('CONFIRMADO');
  await page.goto(`/r/${codigo}?collection_status=approved`);
  await expect(page.getByText('¡Turno confirmado!')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Código QR de la reserva' })).toBeVisible();
});

test('celular: grilla por horario, barra inferior y pago por transferencia', async ({ browser }) => {
  const contexto = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: 'UTC',
  });
  const page = await contexto.newPage();
  await page.goto(`/${SLUG}`);
  await elegirUltimoSabado(page);

  await page.getByRole('button', { name: 'Cancha 2 22:00, $45.000' }).last().click();
  const barra = page.getByRole('button', { name: 'Continuar' });
  await expect(barra).toBeVisible();
  await barra.click();
  await page.getByLabel('Nombre y apellido').fill('Martín Gómez');
  await page.getByRole('textbox', { name: 'WhatsApp' }).fill('11 5100-2002');
  await page.getByRole('button', { name: 'Reservar y pagar la seña' }).click();
  await page.waitForURL(/\/r\/[0-9a-f]{32}$/);

  await expect(page.getByText('la.canchita.mp')).toBeVisible();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'comprobante.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Comprobante recibido')).toBeVisible();
  await contexto.close();
});

test('tiempo real: si otro cliente reserva, el horario se marca ocupado sin recargar', async ({
  page,
  request,
}) => {
  await page.goto(`/${SLUG}`);
  await elegirUltimoSabado(page);
  const boton = page.getByRole('button', { name: 'Cancha 1 23:00, $45.000' }).first();
  await expect(boton).toBeEnabled();

  await reservarPorApi(request, {
    fecha: ultimoSabado(),
    hora: '23:00',
    cancha: 'Cancha 1',
    nombre: 'Otro',
    telefono: '11 5100-2003',
  });
  await expect(page.getByRole('button', { name: 'Cancha 1 23:00, Ocupado' }).first()).toBeDisabled();
});

test('si el horario se ocupa mientras completa los datos, se le avisa', async ({ page, request }) => {
  await page.goto(`/${SLUG}`);
  await elegirUltimoSabado(page);
  await page.getByRole('button', { name: 'Cancha 2 23:00, $45.000' }).first().click();
  await page.getByLabel('Nombre y apellido').fill('Lenta');

  await reservarPorApi(request, {
    fecha: ultimoSabado(),
    hora: '23:00',
    cancha: 'Cancha 2',
    nombre: 'Rápida',
    telefono: '11 5100-2004',
  });
  await expect(page.getByText('Ese horario se acaba de ocupar. Elegí otro.')).toBeVisible();
});

test('un club que no existe muestra la página de no encontrado', async ({ page }) => {
  await page.goto('/club-que-no-existe');
  await expect(page.getByRole('heading', { name: 'No encontramos ese club' })).toBeVisible();
});
