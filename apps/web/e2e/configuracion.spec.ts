import { expect, test } from '@playwright/test';
import { elegirUltimoSabado, entrarAlPanel, SLUG, ultimoSabado } from './utilidades';

test('una tarifa cargada desde el panel cambia el precio en la página pública, y se puede borrar', async ({
  page,
}) => {
  const fecha = ultimoSabado();
  const base = await entrarAlPanel(page);
  await page.goto(`${base}/configuracion#tarifas`);
  await expect(page.getByRole('tab', { name: 'Tarifas', selected: true })).toBeVisible();

  await page.getByRole('button', { name: 'Agregar tarifa' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Nueva tarifa' });
  await dialogo.getByLabel('Cancha').selectOption({ label: 'Cancha 1' });
  await dialogo.getByLabel('Día').selectOption({ label: 'Sábado' });
  await dialogo.getByLabel('Desde', { exact: true }).fill('22:00');
  await dialogo.getByLabel('Hasta', { exact: true }).fill('23:00');
  await dialogo.getByLabel('Precio del turno ($)').fill('61000');
  await dialogo.getByLabel('Etiqueta (opcional)').fill('Promo e2e');
  // Solo ese sábado, para no cambiarle los precios a los otros tests.
  await dialogo.getByLabel('Vigente desde').fill(fecha);
  await dialogo.getByLabel('Vigente hasta (opcional)').fill(fecha);
  await dialogo.getByRole('button', { name: 'Agregar tarifa' }).click();
  await expect(dialogo).toBeHidden();
  const fila = page
    .getByRole('region', { name: 'Cancha 1' })
    .getByRole('listitem')
    .filter({ hasText: 'Promo e2e' });
  await expect(fila).toContainText('Sábado · 22:00 a 23:00 · $61.000');

  // Una que se pisa: el error del servidor se muestra en el diálogo.
  await page.getByRole('button', { name: 'Agregar tarifa' }).click();
  await dialogo.getByLabel('Desde', { exact: true }).fill('19:00');
  await dialogo.getByLabel('Hasta', { exact: true }).fill('21:00');
  await dialogo.getByLabel('Precio del turno ($)').fill('1000');
  await dialogo.getByRole('button', { name: 'Agregar tarifa' }).click();
  await expect(dialogo.getByRole('alert').filter({ hasText: 'Se pisa con' })).toBeVisible();
  await dialogo.getByRole('button', { name: 'Cerrar' }).click();

  const publica = await page.context().newPage();
  await publica.goto(`/${SLUG}`);
  await elegirUltimoSabado(publica);
  await expect(publica.getByRole('button', { name: 'Cancha 1 22:00, $61.000' })).toBeVisible();
  await expect(publica.getByRole('button', { name: 'Cancha 2 22:00, $45.000' })).toBeVisible();

  await fila.getByRole('button', { name: 'Borrar' }).click();
  await expect(fila).toHaveCount(0);
  await publica.reload();
  await elegirUltimoSabado(publica);
  await expect(publica.getByRole('button', { name: 'Cancha 1 22:00, $45.000' })).toBeVisible();
});

test('horarios: una franja que se pisa no se guarda; avisos y usuarios del dueño', async ({ page }) => {
  const base = await entrarAlPanel(page);
  await page.goto(`${base}/configuracion#horarios`);
  await page.getByRole('button', { name: 'Agregar horario al lunes' }).click();
  await page.getByLabel('Lunes: abre').last().fill('12:00');
  await page.getByRole('button', { name: 'Guardar horarios' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /se pisa/ })).toBeVisible();
  await page.getByRole('button', { name: 'Descartar cambios' }).click();
  await expect(page.getByLabel('Lunes: abre')).toHaveCount(1);

  await page.getByRole('tab', { name: 'Usuarios' }).click();
  await page.getByLabel('Nombre').fill('Caja Turno Noche');
  await page.getByLabel('Email').fill('caja-noche@e2e.test');
  await page.locator('form').getByLabel('Rol').selectOption({ label: 'Recepción' });
  await page.getByRole('button', { name: 'Sumar al club' }).click();
  await expect(page.getByText(/Contraseña: \S{12}/)).toBeVisible();
  await expect(page.getByLabel('Rol de Caja Turno Noche')).toHaveValue('RECEPCION');
});
