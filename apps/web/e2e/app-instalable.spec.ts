import { expect, test } from '@playwright/test';
import { SLUG } from './utilidades';

test('el panel se puede instalar como app; la página del club no abre el panel', async ({
  page,
  request,
}) => {
  await page.goto('/panel/login');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/panel.webmanifest');
  const manifest = await (await request.get(href as string)).json();
  expect(manifest).toMatchObject({ start_url: '/panel', scope: '/panel', display: 'standalone' });
  for (const icono of manifest.icons as { src: string; sizes: string }[]) {
    const r = await request.get(icono.src);
    expect(r.status(), icono.src).toBe(200);
    expect(r.headers()['content-type']).toBe('image/png');
  }
  expect(await page.locator('link[rel="apple-touch-icon"]').count()).toBeGreaterThan(0);

  await page.goto(`/${SLUG}`);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
});
