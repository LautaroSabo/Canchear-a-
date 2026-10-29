import { expect, test } from '@playwright/test';
import { API, DUENIO, entrarAlPanel, PNG, reservarPorApi, ultimoSabado } from './utilidades';

test('login: credenciales incorrectas y correctas', async ({ page }) => {
  await page.goto('/panel/login');
  await page.getByLabel('Email').fill(DUENIO.email);
  await page.getByLabel('Contraseña').fill('equivocada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Email o contraseña incorrectos')).toBeVisible();
  await entrarAlPanel(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('transferencia: aparece en la agenda, se aprueba, check-in con el código y cobro del saldo', async ({
  page,
  request,
}) => {
  const fecha = ultimoSabado();
  const r = await reservarPorApi(request, {
    fecha,
    hora: '20:00',
    cancha: 'Cancha 2',
    nombre: 'Sofía Ruiz',
    telefono: '11 5100-3001',
  });
  const subida = await request.post(`${API}/public/reservas/${r.codigo}/transferencia`, {
    multipart: { comprobante: { name: 'c.png', mimeType: 'image/png', buffer: PNG } },
  });
  expect(subida.status()).toBe(201);

  const base = await entrarAlPanel(page);
  await page.goto(`${base}/agenda?fecha=${fecha}`);
  // Navegador en UTC: el bloque tiene que decir 20:00 (hora del club).
  await expect(
    page.getByRole('button', { name: 'Sofía Ruiz, 20:00, Transferencia a revisar' }),
  ).toBeVisible();

  await page.getByRole('link', { name: /Transferencias/ }).click();
  await expect(page.getByRole('img', { name: 'Comprobante de transferencia' })).toBeVisible();
  await expect(page.getByText(/Cancha 2 · Sábado \d\d\/\d\d 20:00/)).toBeVisible();
  await page.getByRole('button', { name: 'Aprobar y confirmar el turno' }).click();
  await expect(page.getByText('No hay comprobantes para revisar.')).toBeVisible();

  await page.goto(`${base}/agenda?fecha=${fecha}`);
  await expect(page.getByRole('button', { name: 'Sofía Ruiz, 20:00, Confirmado' })).toBeVisible();

  await page.goto(`${base}/checkin`);
  await page.getByLabel('Código o link de la reserva').fill(`http://localhost:3100/r/${r.codigo}`);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('La reserva es para otro horario')).toBeVisible();
  await page.getByRole('button', { name: 'Hacer el check-in igual' }).click();
  await expect(page.getByText('Sofía Ruiz está en cancha')).toBeVisible();
  await page.getByRole('button', { name: 'Cobré $22.500 en efectivo' }).click();
  await expect(page.getByText('Cobro registrado.')).toBeVisible();
});

test('carga manual desde la agenda y cancelación', async ({ page }) => {
  const fecha = ultimoSabado();
  const base = await entrarAlPanel(page);
  await page.goto(`${base}/agenda?fecha=${fecha}`);

  await page.getByRole('button', { name: '+ Nuevo turno' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Nuevo turno' });
  await dialogo.getByLabel('Desde').fill('15:00');
  await dialogo.getByLabel('Nombre').fill('Los del Jueves');
  await dialogo.getByRole('textbox', { name: 'WhatsApp' }).fill('11 5100-3002');
  await dialogo.getByRole('button', { name: /Cargar turno/ }).click();
  await expect(page.getByText(/Turno cargado para Los del Jueves/)).toBeVisible();

  await page.getByRole('button', { name: 'Los del Jueves, 15:00, Confirmado' }).click();
  await page.getByText('Más acciones').click();
  await page.getByRole('button', { name: 'Cancelar turno' }).click();
  const cancelar = page.getByRole('dialog', { name: 'Cancelar turno' });
  await cancelar.getByLabel('Motivo').fill('Lluvia');
  await cancelar.getByRole('button', { name: 'Cancelar turno' }).click();
  await expect(page.getByText(/Turno cancelado\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Los del Jueves, 15:00, Confirmado' })).toHaveCount(0);
});
