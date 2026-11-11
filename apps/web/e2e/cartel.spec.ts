import { expect, test } from '@playwright/test';
import { entrarAlPanel, SLUG } from './utilidades';

test('cartel con QR: lleva a la página de reservas del club y se imprime solo la hoja', async ({ page }) => {
  await entrarAlPanel(page);
  await page.getByRole('link', { name: 'Cartel con QR' }).click();
  await expect(page.getByRole('heading', { name: 'Cartel con QR' })).toBeVisible();
  const cartel = page.locator('#cartel-imprimible');
  await expect(
    cartel.getByRole('img', { name: new RegExp(`Código QR que lleva a .*/${SLUG}$`) }),
  ).toBeVisible();
  await expect(cartel).toContainText(`/${SLUG}`);
  await expect(page.getByRole('link', { name: 'Bajar el QR (imagen)' })).toHaveAttribute(
    'download',
    `qr-${SLUG}.png`,
  );

  if (process.env.CAPTURAS)
    await page.screenshot({ path: 'test-results/cartel-pantalla.png', fullPage: true });
  // Al imprimir no se ven el menú ni los botones.
  await page.setViewportSize({ width: 794, height: 1123 }); // proporción de una hoja A4
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Imprimir' })).toBeHidden();
  if (process.env.CAPTURAS) await page.screenshot({ path: 'test-results/cartel-impreso.png' });
});
