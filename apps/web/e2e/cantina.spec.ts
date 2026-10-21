import { expect, test } from '@playwright/test';
import { entrarAlPanel, ultimoSabado } from './utilidades';

test('mostrador: venta en efectivo, aparece en las ventas del día y se anula devolviendo el stock', async ({
  page,
}) => {
  await entrarAlPanel(page);
  await page.getByRole('link', { name: 'Cantina' }).click();
  await expect(page.getByRole('heading', { name: 'Cantina' })).toBeVisible();

  await page.getByRole('button', { name: 'Agregar Agua 500ml, $1.500' }).click();
  await page.getByRole('button', { name: 'Agregar Agua 500ml, $1.500' }).click();
  await page.getByRole('button', { name: 'Agregar Alquiler pelota, $2.000' }).click();
  const pedido = page.getByRole('region', { name: 'Pedido' });
  await expect(pedido).toContainText('$5.000');
  await pedido.getByRole('button', { name: 'Sacar un Agua 500ml' }).click();
  await expect(pedido).toContainText('$3.500');
  await pedido.getByLabel('Medio de pago').selectOption({ label: 'Efectivo' });
  await pedido.getByRole('button', { name: 'Cobrar $3.500' }).click();
  await expect(page.getByText('Listo: $3.500. Cobrado en efectivo.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar Agua 500ml, $1.500' })).toContainText('quedan 47');

  await page.getByRole('tab', { name: 'Ventas de hoy' }).click();
  await expect(page.getByText('1 × Agua 500ml, 1 × Alquiler pelota')).toBeVisible();
  await expect(page.getByText('Efectivo $3.500')).toBeVisible();
  await page.getByRole('button', { name: 'Anular' }).click();
  const anular = page.getByRole('dialog', { name: 'Anular venta' });
  await anular.getByLabel('Motivo').fill('Se cobró dos veces');
  await anular.getByRole('button', { name: 'Anular venta' }).click();
  await expect(page.getByText('Anulada: Se cobró dos veces')).toBeVisible();

  await page.getByRole('tab', { name: 'Productos y stock' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Agua 500ml' })).toContainText('stock 48');
});

test('consumo a cuenta del turno: suma al saldo que se cobra en el turno', async ({ page }) => {
  const fecha = ultimoSabado();
  const base = await entrarAlPanel(page);
  await page.goto(`${base}/agenda?fecha=${fecha}`);
  await page.getByRole('button', { name: '+ Nuevo turno' }).click();
  const nuevo = page.getByRole('dialog', { name: 'Nuevo turno' });
  await nuevo.getByLabel('Desde').fill('11:00');
  await nuevo.getByLabel('Nombre').fill('Los Sedientos');
  await nuevo.getByRole('textbox', { name: 'WhatsApp' }).fill('11 5100-5001');
  await nuevo.getByRole('button', { name: /Cargar turno/ }).click();
  await page.getByRole('button', { name: 'Los Sedientos, 11:00, Confirmado' }).click();

  await page.getByRole('button', { name: '+ Cargar de la cantina' }).click();
  const cantina = page.getByRole('dialog', { name: 'Cantina · Los Sedientos' });
  await cantina.getByRole('button', { name: 'Agregar Gatorade 500ml, $2.500' }).click();
  await cantina.getByRole('button', { name: 'Cargar $2.500 al turno' }).click();
  await expect(page.getByText('Cargado a la cuenta: $2.500.')).toBeVisible();

  const detalle = page.getByRole('region', { name: 'Cantina del turno' });
  await expect(detalle).toContainText('1 × Gatorade 500ml');
  await expect(page.getByRole('button', { name: 'Cobrar saldo $32.500' })).toBeVisible();
});
