import { expect, test } from '@playwright/test';
import { entrarAlPanel, reservarPorApi } from './utilidades';

const BA = 'America/Argentina/Buenos_Aires';
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Un miércoles entre 7 y 13 días adelante: siempre dentro del horizonte y nunca hoy. */
function miercolesProximo() {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: BA }).format(new Date());
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test('turno fijo: vista previa con el choque, alta, fecha a resolver y baja', async ({ page, request }) => {
  const choque = miercolesProximo();
  await reservarPorApi(request, {
    fecha: choque,
    hora: '22:00',
    cancha: 'Cancha 1',
    nombre: 'Reserva Suelta',
    telefono: '11 5100-4001',
  });
  const [, m, d] = choque.split('-');
  const etiquetaChoque = `${DIAS[3]} ${d}/${m}`;

  const base = await entrarAlPanel(page);
  await page.getByRole('link', { name: 'Turnos fijos' }).click();
  await expect(page.getByRole('heading', { name: 'Turnos fijos' })).toBeVisible();
  await page.getByRole('button', { name: '+ Nuevo turno fijo' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Nuevo turno fijo' });
  await dialogo.getByLabel('Cancha').selectOption({ label: 'Cancha 1' });
  await dialogo.getByLabel('Día').selectOption({ label: 'Miércoles' });
  await dialogo.getByLabel('Hora').fill('22:00');
  await dialogo.getByLabel('Nombre del cliente o equipo').fill('Los Miércoles FC');
  await dialogo.getByRole('textbox', { name: 'WhatsApp' }).fill('11 5100-4002');

  const previa = dialogo.getByRole('region', { name: 'Próximas fechas' });
  await expect(previa).toContainText(/\d de \d fechas libres/);
  await expect(previa).toContainText(`${etiquetaChoque}: La cancha ya está tomada (Reserva Suelta)`);
  await dialogo.getByRole('button', { name: 'Crear turno fijo' }).click();
  await expect(
    page.getByText(/Turno fijo de Los Miércoles FC creado: \d turnos agendados, 1 con problemas/),
  ).toBeVisible();

  const ficha = page.getByRole('region', { name: 'Miércoles' });
  await expect(ficha).toContainText('22:00 · Cancha 1 · Los Miércoles FC');
  const pendientes = ficha.getByRole('list', { name: 'Fechas sin agendar' });
  await expect(pendientes).toContainText(`${etiquetaChoque}: La cancha ya está tomada (Reserva Suelta)`);
  // Aviso en el menú.
  await expect(page.getByRole('link', { name: /Turnos fijos\s*1/ })).toBeVisible();

  await page.goto(`${base}/agenda?fecha=${choque}`);
  await expect(page.getByRole('button', { name: /Reserva Suelta, 22:00/ })).toBeVisible();

  await page.goto(`${base}/turnos-fijos`);
  await pendientes.getByRole('button', { name: 'Ya lo resolví' }).click();
  await expect(pendientes).toHaveCount(0);

  await ficha.getByRole('button', { name: 'Dar de baja' }).click();
  await page
    .getByRole('dialog', { name: 'Dar de baja el turno fijo' })
    .getByRole('button', { name: 'Dar de baja' })
    .click();
  await expect(
    page.getByText(/Turno fijo de Los Miércoles FC dado de baja\. Se liberaron \d turnos\./),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Miércoles' })).toHaveCount(0);
});
