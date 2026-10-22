import { expect, test } from '@playwright/test';
import { entrarAlPanel } from './utilidades';

test('reportes: resumen, gráficos con tooltip, cambio de período y exportación', async ({ page }) => {
  await entrarAlPanel(page);
  await page.getByRole('link', { name: 'Reportes' }).click();
  await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();
  const resumen = page.getByRole('region', { name: 'Resumen' });
  await expect(resumen).toContainText('Cobrado');
  await expect(resumen).toContainText('Ocupación');

  // Los otros tests ya cobraron cosas hoy: el día de hoy tiene una columna con tooltip.
  const columnas = page.getByRole('button', {
    name: /^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo) \d\d\/\d\d: \$/,
  });
  await expect(columnas.first()).toBeVisible();
  await columnas.last().focus();
  await expect(page.getByRole('status').filter({ hasText: 'ocupación' })).toBeVisible();

  await page.getByRole('button', { name: 'Ver como tabla' }).click();
  await expect(page.getByRole('columnheader', { name: 'Cobrado' })).toBeVisible();

  const celda = page.getByRole('cell', { name: /Sábado 20:00 · \d+% ocupado/ });
  await expect(celda).toBeVisible();

  if (process.env.CAPTURAS)
    await page.screenshot({ path: `${process.env.CAPTURAS}/reportes.png`, fullPage: true });

  await page.getByRole('button', { name: 'Mes pasado' }).click();
  await expect(page.getByRole('button', { name: 'Mes pasado' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Últimos 30 días' }).click();
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Pagos' }).click();
  const archivo = await descarga;
  expect(archivo.suggestedFilename()).toMatch(/^pagos-\d{4}-\d\d-\d\d-a-\d{4}-\d\d-\d\d\.csv$/);

  if (process.env.CAPTURAS) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.CAPTURAS}/reportes-celu.png`, fullPage: true });
  }
});
