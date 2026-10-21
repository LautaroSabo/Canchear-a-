import 'server-only';
import { notFound } from 'next/navigation';
import { API_URL, ErrorApi, pedir } from './api';
import type { ClubPublico } from './tipos';

const BASE_SSR = (process.env.API_URL_INTERNA ?? API_URL).replace(/\/$/, '');

/** Club por slug desde el servidor de Next (SSR y metadatos). 404 → página de no encontrado. */
export async function cargarClub(slug: string): Promise<ClubPublico> {
  if (!/^[a-z0-9-]{3,60}$/i.test(slug)) notFound();
  try {
    return await pedir<ClubPublico>(`/public/clubs/${slug}`, { base: BASE_SSR });
  } catch (e) {
    if (e instanceof ErrorApi && e.status === 404) notFound();
    throw e;
  }
}
