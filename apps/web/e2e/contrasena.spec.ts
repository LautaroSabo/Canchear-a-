import { expect, test } from '@playwright/test';
import { API } from './utilidades';

test('olvidé mi contraseña: llega el link por mail y se elige una nueva', async ({ page, request }) => {
  // Un usuario propio para no tocar la contraseña del dueño que usan los otros e2e.
  await page.goto('/registrar');
  await page.getByLabel('Nombre del club').fill('Club Contraseña');
  await expect(page.getByText('Disponible.')).toBeVisible();
  await page.getByLabel('WhatsApp del club').fill('11 5100-8001');
  await page.getByLabel('Tu nombre').fill('Olvi Dadizo');
  await page.getByLabel('Email').fill('olvido@e2e.test');
  await page.getByLabel('Contraseña').fill('la-primera-clave');
  await page.getByRole('button', { name: 'Registrar mi club' }).click();
  await page.waitForURL(/\/configuracion/);
  await page.context().clearCookies();

  await page.goto('/panel/login');
  await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click();
  // Habilitado = la página ya hidrató y el envío lo maneja React.
  await expect(page.getByRole('button', { name: 'Mandarme el link' })).toBeEnabled();
  await page.getByLabel('Email').fill('olvido@e2e.test');
  await page.getByRole('button', { name: 'Mandarme el link' }).click();
  await expect(page.getByText(/te llegó un mail con el link/)).toBeVisible();

  let link = '';
  await expect(async () => {
    const mail = await (await request.get(`${API}/__e2e/correo/ultimo`)).json();
    expect(mail?.para).toBe('olvido@e2e.test');
    link = mail.texto.match(/https?:\/\/\S+/)[0];
  }).toPass();

  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await page.getByLabel('Contraseña nueva').fill('la-segunda-clave');
  await page.getByLabel('Repetila').fill('otra-distinta-x');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByText('Las dos contraseñas no coinciden.')).toBeVisible();
  await page.getByLabel('Repetila').fill('la-segunda-clave');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByText('Listo, tu contraseña cambió.')).toBeVisible();

  await page.getByRole('link', { name: 'Entrar al panel' }).click();
  await page.getByLabel('Email').fill('olvido@e2e.test');
  await page.getByLabel('Contraseña').fill('la-segunda-clave');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/panel\/[0-9a-f-]{36}\//);
});
