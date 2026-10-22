import { expect, test } from '@playwright/test';
import { entrarAlPanel, ultimoSabado } from './utilidades';

test('puntos: el check-in suma, se ajustan, se canjea un descuento y se aplica al turno', async ({
  page,
}) => {
  const fecha = ultimoSabado();
  const base = await entrarAlPanel(page);
  await page.goto(`${base}/agenda?fecha=${fecha}`);
  await page.getByRole('button', { name: '+ Nuevo turno' }).click();
  const nuevo = page.getByRole('dialog', { name: 'Nuevo turno' });
  await nuevo.getByLabel('Desde').fill('12:00');
  await nuevo.getByLabel('Nombre').fill('Pepa Puntera');
  await nuevo.getByRole('textbox', { name: 'WhatsApp' }).fill('11 5100-6001');
  await nuevo.getByRole('button', { name: /Cargar turno/ }).click();

  const bloque = page.getByRole('button', { name: /^Pepa Puntera, 12:00/ });
  await bloque.click();
  await page.getByRole('button', { name: 'Hacer check-in' }).click();
  await page.getByRole('button', { name: 'Hacer el check-in igual' }).click();
  await expect(page.getByText('Pepa Puntera está en cancha. Sumó 10 puntos.')).toBeVisible();

  await page.getByRole('link', { name: 'Clientes y puntos' }).click();
  await page.getByLabel('Buscar por nombre o teléfono').fill('6001');
  await page
    .getByRole('list', { name: 'Resultados' })
    .getByRole('button', { name: /Pepa Puntera/ })
    .click();
  await expect(page.getByText('Partido del')).toBeVisible();

  await page.getByRole('button', { name: 'Ajustar puntos' }).click();
  const ajuste = page.getByRole('dialog', { name: 'Ajustar puntos · Pepa Puntera' });
  await ajuste.getByLabel('Puntos (negativo para restar)').fill('140');
  await ajuste.getByLabel('Motivo').fill('Cliente de siempre');
  await ajuste.getByRole('button', { name: 'Guardar ajuste' }).click();
  await expect(page.getByText('Listo: ahora tiene 150 puntos.')).toBeVisible();

  await page.getByRole('button', { name: 'Canjear premio' }).click();
  const canje = page.getByRole('dialog', { name: 'Canjear · Pepa Puntera' });
  await expect(canje.getByRole('radio', { name: /Turno F5 gratis/ })).toBeDisabled();
  await canje.getByRole('radio', { name: /20% off en un turno/ }).check();
  await canje.getByRole('button', { name: 'Canjear por 150 puntos' }).click();
  await expect(
    page.getByText(/Canjeado: queda para usar en un turno \(código [0-9A-F]{10}\)\./),
  ).toBeVisible();

  await page.goto(`${base}/agenda?fecha=${fecha}`);
  await page.getByRole('button', { name: /^Pepa Puntera, 12:00/ }).click();
  const canjes = page.getByRole('region', { name: 'Canjes de puntos' });
  await canjes.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Canje aplicado: −$6.000.')).toBeVisible();
  await expect(canjes).toContainText('20% off en un turno: −$6.000');
  await expect(page.getByRole('button', { name: 'Cobrar saldo $24.000' })).toBeVisible();
});
