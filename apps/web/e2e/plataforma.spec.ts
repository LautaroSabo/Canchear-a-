import { expect, test } from '@playwright/test';

test('un club se registra solo, espera aprobación y la plataforma lo habilita', async ({ browser }) => {
  // El dueño del club nuevo.
  const club = await browser.newContext();
  const dueno = await club.newPage();
  await dueno.goto('/registrar');
  await dueno.getByLabel('Nombre del club').fill('El Potrero E2E');
  await expect(dueno.getByLabel('Dirección de tu página')).toHaveValue('el-potrero-e2e');
  await expect(dueno.getByText('Disponible.')).toBeVisible();
  await dueno.getByLabel('WhatsApp del club').fill('11 5100-7001');
  await dueno.getByLabel('Tu nombre').fill('Ana Dueña');
  await dueno.getByLabel('Email').fill('ana@potrero-e2e.test');
  await dueno.getByLabel('Contraseña').fill('corta');
  await dueno.getByRole('button', { name: 'Registrar mi club' }).click();
  await expect(dueno.getByText('Usá al menos 10 caracteres.')).toBeVisible();
  await dueno.getByLabel('Contraseña').fill('una-clave-larga');
  await dueno.getByRole('button', { name: 'Registrar mi club' }).click();

  await dueno.waitForURL(/\/panel\/[0-9a-f-]{36}\/configuracion/);
  await expect(dueno.getByText('Tu club está en revisión.')).toBeVisible();

  // La página pública se ve, pero no toma reservas.
  const publica = await club.newPage();
  await publica.goto('/el-potrero-e2e');
  await expect(publica.getByText('Este club todavía no toma reservas online.')).toBeVisible();

  // La plataforma lo aprueba con 15 días de prueba.
  const plataforma = await browser.newContext();
  const admin = await plataforma.newPage();
  await admin.goto('/panel/login');
  await admin.getByLabel('Email').fill('plataforma@e2e.test');
  await admin.getByLabel('Contraseña').fill('contrasena-e2e');
  await admin.getByRole('button', { name: 'Entrar' }).click();
  await admin.waitForURL(/\/panel\/plataforma/);
  const fila = admin.getByRole('listitem').filter({ hasText: 'El Potrero E2E' });
  await expect(fila).toContainText('ana@potrero-e2e.test');
  await fila.getByRole('button', { name: 'Aprobar' }).click();
  const dialogo = admin.getByRole('dialog', { name: 'Aprobar El Potrero E2E' });
  await dialogo.getByLabel('Días de prueba gratis').fill('15');
  await dialogo.getByRole('button', { name: 'Aprobar club' }).click();
  await expect(admin.getByText('El Potrero E2E ya toma reservas.')).toBeVisible();

  // Registra el primer mes del abono.
  await admin.getByRole('tab', { name: 'Activos' }).click();
  const activa = admin.getByRole('listitem').filter({ hasText: 'El Potrero E2E' });
  await activa.getByRole('button', { name: 'Registrar pago' }).click();
  const pago = admin.getByRole('dialog', { name: 'Pago del abono · El Potrero E2E' });
  await pago.getByLabel('Monto ($)').fill('25000');
  await pago.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(
    admin.getByText(/Pago registrado: El Potrero E2E tiene el abono cubierto hasta el/),
  ).toBeVisible();

  await publica.reload();
  await expect(publica.getByText('Este club todavía no toma reservas online.')).toHaveCount(0);
  await club.close();
  await plataforma.close();
});
