import { type APIRequestContext, expect, type Page } from '@playwright/test';

export const API = 'http://localhost:3101';
export const SLUG = 'la-canchita';
export const DUENIO = { email: 'duenio@e2e.test', contrasena: 'contrasena-e2e' };
const BA = 'America/Argentina/Buenos_Aires';

/** PNG mínimo válido (el servidor valida el comprobante por su contenido). */
export const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

/** El último sábado de la tira de 14 días: siempre está a 7+ días (nunca "muy cerca"). */
export async function elegirUltimoSabado(page: Page) {
  // El último sábado dentro de 14 días siempre cae en la segunda semana de la tira.
  await page.getByRole('button', { name: 'Semana siguiente' }).click();
  const sabados = page.getByRole('button', { name: /^Sábado \d\d\/\d\d$/ });
  await expect(sabados.first()).toBeVisible();
  await sabados.last().click();
  return (await sabados.last().getAttribute('aria-label')) ?? '';
}

/** Fecha (YYYY-MM-DD, hora de Buenos Aires) del último sábado dentro de 14 días. */
export function ultimoSabado(): string {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: BA }).format(new Date());
  const d = new Date(`${hoy}T12:00:00Z`);
  let ultimo = '';
  for (let i = 0; i < 14; i++) {
    if (d.getUTCDay() === 6) ultimo = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return ultimo;
}

/** Reserva por API (como lo haría otro cliente desde su celular). */
export async function reservarPorApi(
  request: APIRequestContext,
  {
    fecha,
    hora,
    cancha,
    nombre,
    telefono,
  }: { fecha: string; hora: string; cancha: string; nombre: string; telefono: string },
) {
  const disp = await (await request.get(`${API}/public/clubs/${SLUG}/disponibilidad?fecha=${fecha}`)).json();
  const c = disp.canchas.find((x: { nombre: string }) => x.nombre === cancha);
  const inicio = new Date(`${fecha}T${hora}:00-03:00`).toISOString();
  const res = await request.post(`${API}/public/clubs/${SLUG}/reservas`, {
    data: { canchaId: c.id, inicio, cliente: { nombre, telefono }, idempotencyKey: crypto.randomUUID() },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { codigo: string; estado: string };
}

export async function entrarAlPanel(page: Page) {
  await page.goto('/panel');
  await page.waitForURL(/\/panel\/login/);
  await page.getByLabel('Email').fill(DUENIO.email);
  await page.getByLabel('Contraseña').fill(DUENIO.contrasena);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/panel\/[0-9a-f-]{36}\/agenda/);
  return page.url().split('/agenda')[0] as string;
}
