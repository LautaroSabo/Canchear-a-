import { expect, test } from '@playwright/test';
import { codigoTotp, pasoDe } from '../../../packages/servicios/src/totp';

test('verificación en dos pasos: se activa con la app y después pide el código al entrar', async ({
  page,
}) => {
  // Una cuenta propia, para no tocar la del dueño que usan los otros e2e.
  await page.goto('/registrar');
  await page.getByLabel('Nombre del club').fill('Club Dos Pasos');
  await expect(page.getByText('Disponible.')).toBeVisible();
  await page.getByLabel('WhatsApp del club').fill('11 5100-8101');
  await page.getByLabel('Tu nombre').fill('Doble Paso');
  await page.getByLabel('Email').fill('dospasos@e2e.test');
  await page.getByLabel('Contraseña').fill('la-clave-de-dos-pasos');
  await page.getByRole('checkbox', { name: /Acepto los Términos/ }).check();
  await page.getByRole('button', { name: 'Registrar mi club' }).click();
  await page.waitForURL(/\/configuracion/);

  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  const tarjeta = page.getByRole('main');
  await tarjeta.getByRole('button', { name: 'Activar', exact: true }).click();
  await expect(tarjeta.getByRole('img', { name: 'Código QR para la app autenticadora' })).toBeVisible();
  const secreto = ((await tarjeta.locator('code').last().textContent()) ?? '').replace(/\s/g, '');
  expect(secreto).toMatch(/^[A-Z2-7]{32}$/);
  await tarjeta.getByLabel(/Escribí el código de 6 números/).fill(codigoTotp(secreto, pasoDe(new Date())));
  await tarjeta.getByRole('button', { name: 'Activar', exact: true }).click();
  await expect(page.getByText('Guardá estos códigos de recuperación')).toBeVisible();
  const recuperacion =
    (await tarjeta
      .locator('ul li')
      .filter({ hasText: /^[A-Z2-9]{4}-[A-Z2-9]{4}$/ })
      .first()
      .textContent()) ?? '';
  expect(recuperacion).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await tarjeta.getByRole('button', { name: 'Ya los guardé' }).click();
  await expect(tarjeta.getByText('Activada', { exact: true })).toBeVisible();

  // Salir y volver a entrar: la contraseña sola no alcanza.
  await page.context().clearCookies();
  await page.goto('/panel/login');
  await page.getByLabel('Email').fill('dospasos@e2e.test');
  await page.getByLabel('Contraseña').fill('la-clave-de-dos-pasos');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Verificación en dos pasos' })).toBeVisible();
  await page.getByLabel('Código').fill('000000');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('El código no es correcto')).toBeVisible();
  // Con un código de recuperación (el de la app de recién ya se usó en estos 30 segundos).
  await page.getByLabel('Código').fill(recuperacion);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/panel\/[0-9a-f-]{36}\//);
});
