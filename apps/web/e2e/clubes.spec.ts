import { expect, test } from '@playwright/test';

test('página de venta: se llega desde la portada, muestra el precio y lleva al registro', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Ver todo lo que hace' }).click();
  await expect(page.getByRole('heading', { name: 'Tu club reserva y cobra solo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Todo lo que hace' })).toBeVisible();
  // Precios por cantidad de canchas.
  const precios = page.getByRole('table');
  await expect(precios.getByRole('row', { name: /Chico 1 a 3 canchas/ })).toContainText('$39.900');
  await expect(precios.getByRole('row', { name: /Mediano 4 a 6 canchas/ })).toContainText('$59.900');
  await expect(precios.getByRole('row', { name: /Grande 7 o más canchas/ })).toContainText('$79.900');
  await page.getByText('¿Necesito Mercado Pago?').click();
  await expect(page.getByText(/Podés cobrar la seña por transferencia/)).toBeVisible();
  if (process.env.CAPTURAS) {
    await page.screenshot({ path: 'test-results/clubes.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/clubes-cel.png', fullPage: true });
  }
  await page
    .getByRole('link', { name: /^Probalo gratis \d+ días$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/registrar$/);
});
