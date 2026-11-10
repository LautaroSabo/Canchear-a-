import { expect, test } from '@playwright/test';
import { elegirUltimoSabado, entrarAlPanel, SLUG } from './utilidades';

test('cancha de pádel: se carga en el panel y se reserva aparte de las de fútbol', async ({ page }) => {
  const base = await entrarAlPanel(page);
  await page.goto(`${base}/configuracion#canchas`);
  await page.getByRole('button', { name: 'Agregar cancha' }).first().click();
  const dialogo = page.getByRole('dialog', { name: 'Nueva cancha' });
  await dialogo.getByLabel('Nombre').fill('Pádel 1');
  await dialogo.getByLabel('Deporte').selectOption({ label: 'Pádel' });
  // En pádel no se elige de a cuántos y el turno pasa a 90 minutos.
  await expect(dialogo.getByLabel('Jugadores por lado')).toHaveCount(0);
  await expect(dialogo.getByLabel('Duración del turno')).toHaveValue('90');
  await dialogo.getByRole('button', { name: 'Agregar cancha' }).click();
  await expect(page.getByText(/^Pádel · /)).toBeVisible();

  await page.goto(`/${SLUG}`);
  await page.getByRole('button', { name: 'Pádel', exact: true }).click();
  await elegirUltimoSabado(page);
  const turno = page.getByRole('button', { name: /^Pádel 1 \d\d:\d\d, \$/ }).first();
  await expect(turno).toBeVisible();
  await expect(page.getByRole('button', { name: /^Cancha 1 / })).toHaveCount(0);
  await turno.click();
  await expect(page.getByText('Pádel 1 · Pádel')).toBeVisible();
});
