import { expect, test } from '@playwright/test';
import { entrarAlPanel, SLUG } from './utilidades';

test('torneo: alta, inscripción online, sorteo, resultado y página pública con mi equipo', async ({
  page,
}) => {
  await entrarAlPanel(page);
  await page.getByRole('link', { name: 'Torneos y ligas' }).click();
  await expect(page.getByRole('heading', { name: 'Torneos y ligas' })).toBeVisible();
  await page.getByRole('button', { name: '+ Nuevo torneo' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Nuevo torneo' });
  await dialogo.getByLabel('Nombre', { exact: true }).fill('Liga E2E');
  await dialogo.getByRole('checkbox', { name: /^Cancha 1/ }).check();
  await dialogo.getByRole('button', { name: 'Crear torneo' }).click();
  await expect(page.getByRole('heading', { name: 'Liga E2E' })).toBeVisible();
  const urlTorneo = page.url();
  await expect(page.getByText('Inscripción online abierta.')).toBeVisible();

  for (const [nombre, tel] of [
    ['Rojos', '11 5200-0001'],
    ['Azules', '11 5200-0002'],
    ['Verdes', '11 5200-0003'],
  ] as const) {
    await page.getByRole('textbox', { name: 'Equipo', exact: true }).fill(nombre);
    await page.getByRole('textbox', { name: 'Delegado', exact: true }).fill(`Delegado ${nombre}`);
    await page.getByRole('textbox', { name: 'WhatsApp' }).fill(tel);
    await page.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: nombre })).toBeVisible();
  }

  // Un equipo se anota solo desde la página pública.
  await page.goto(`/${SLUG}`);
  await page.getByRole('link', { name: 'Tablas y horarios' }).click();
  await page.getByRole('link', { name: /Liga E2E/ }).click();
  await page.getByLabel('Nombre del equipo').fill('Online FC');
  await page.getByLabel('Delegado (quién se encarga)').fill('Ana');
  await page.getByLabel('WhatsApp del delegado').fill('11 5200-0004');
  await page.getByRole('button', { name: 'Inscribir equipo' }).click();
  await expect(page.getByText(/anotamos a Online FC/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('5200');

  // El club la aprueba, sortea y arma el fixture.
  await page.goto(urlTorneo);
  const online = page.getByRole('listitem').filter({ hasText: 'Online FC' });
  await expect(online).toContainText('Inscripción online');
  await online.getByRole('button', { name: 'Aprobar' }).click();
  await expect(online).not.toContainText('Inscripción online');
  await page.getByRole('button', { name: 'Sortear y armar fixture' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sortear y agendar' }).click();
  await expect(page.getByText(/Torneo en marcha/)).toBeVisible();
  await expect(page.getByText('Inscripción online abierta.')).toHaveCount(0);
  const fecha1 = page.getByRole('region', { name: 'Fecha 1' });
  await expect(fecha1.getByRole('listitem')).toHaveCount(2);
  await expect(fecha1).toContainText('Cancha 1');

  // Resultado del primer partido.
  const partido = fecha1.getByRole('listitem').first();
  await partido.getByRole('button', { name: 'Cargar resultado' }).click();
  const res = page.getByRole('dialog', { name: 'Resultado' });
  await res.getByRole('spinbutton').first().fill('3');
  await res.getByRole('spinbutton').nth(1).fill('1');
  await res.getByRole('button', { name: 'Guardar resultado' }).click();
  await expect(partido).toContainText('3 - 1');

  // Queda bloqueado en la agenda.
  const dia = await partido.textContent();
  expect(dia).toMatch(/\d\d\/\d\d \d\d:\d\d · Cancha 1/);

  // Página pública: tabla y "mi equipo".
  await page.goto(`/${SLUG}/torneos`);
  await page.getByRole('link', { name: /Liga E2E/ }).click();
  await expect(page.getByRole('table')).toContainText('Online FC');
  await expect(page.getByText('La inscripción cerró: el torneo ya está en juego.')).toBeVisible();
  await page.getByRole('combobox', { name: /^Mi equipo/ }).selectOption({ label: 'Online FC' });
  await expect(page.getByText('Próximo partido')).toBeVisible();
  await page.getByRole('tab', { name: 'Mis partidos' }).click();
  await expect(page.getByRole('tabpanel').getByRole('listitem')).toHaveCount(3);
  await page.reload();
  await expect(page.getByRole('combobox', { name: /^Mi equipo/ })).toHaveValue(/.+/);
  // CAPTURAS=1 guarda cómo se ve (para revisar el diseño a ojo).
  if (process.env.CAPTURAS) {
    await page.screenshot({ path: 'test-results/torneo-publico.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/torneo-publico-cel.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(urlTorneo);
    await page.screenshot({ path: 'test-results/torneo-panel.png', fullPage: true });
  }
});
