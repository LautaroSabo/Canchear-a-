import { expect, test } from '@playwright/test';
import { API, entrarAlPanel, ultimoSabado } from './utilidades';

test('caja: muestra lo cobrado, se cierra con lo contado y queda en el historial', async ({ page }) => {
  const base = await entrarAlPanel(page);
  // Un turno cobrado en efectivo, por la API con la sesión del panel (sin tocar la cantina,
  // que tiene su propio e2e con el stock y las ventas del día).
  const clubId = base.split('/').pop();
  const api = process.env.E2E_MISMO_ORIGEN === '1' ? '/api' : API;
  const headers = { 'x-cancheria-csrf': '1' };
  const turno = await page.request.post(`${api}/admin/clubs/${clubId}/turnos`, {
    headers,
    data: {
      canchaId: (await (await page.request.get(`${api}/admin/clubs/${clubId}/config`, { headers })).json())
        .canchas[0].id,
      inicio: new Date(`${ultimoSabado()}T09:00:00-03:00`).toISOString(),
      cliente: { nombre: 'Caja E2E', telefono: '11 5100-9001' },
      notificar: false,
    },
  });
  expect(turno.status(), await turno.text()).toBe(201);
  const pago = await page.request.post(
    `${api}/admin/clubs/${clubId}/turnos/${(await turno.json()).id}/pagos`,
    {
      headers,
      data: { monto: 2_000_000, medio: 'EFECTIVO', concepto: 'SALDO' },
    },
  );
  expect(pago.status(), await pago.text()).toBeLessThan(300);

  await page.goto(`${base}/agenda`);
  await page.getByRole('link', { name: 'Caja', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Caja' })).toBeVisible();
  const efectivo = page.getByRole('row', { name: /^Efectivo/ });
  await expect(efectivo).toContainText('$20.000');
  await page.getByLabel('Efectivo contado').fill('19000');
  await expect(page.getByText('Faltan $1.000')).toBeVisible();
  await page.getByLabel('Nota (opcional)').fill('Vuelto mal dado');
  await page.getByRole('button', { name: 'Cerrar caja' }).click();
  await expect(page.getByText(/Caja cerrada\. Esperado \$20\.000, contado \$19\.000/)).toBeVisible();
  const historial = page.getByRole('region', { name: 'Cierres anteriores' });
  await expect(historial).toContainText('Vuelto mal dado');
  await expect(historial.getByText('Faltan $1.000')).toBeVisible();
});
