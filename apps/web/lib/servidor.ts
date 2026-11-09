import 'server-only';
import { notFound } from 'next/navigation';
import { API_URL, ErrorApi, pedir } from './api';
import type { ClubPublico, PartidoCompartido, TorneoResumen, VistaTorneo } from './tipos';

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

/** Torneos del club (lista corta para la página del club). Si falla, no rompe la página. */
export async function cargarTorneos(slug: string): Promise<TorneoResumen[]> {
  try {
    return await pedir<TorneoResumen[]>(`/public/clubs/${slug}/torneos`, { base: BASE_SSR });
  } catch {
    return [];
  }
}

export async function cargarTorneo(slug: string, torneo: string): Promise<VistaTorneo> {
  if (!/^[a-z0-9-]{1,80}$/i.test(torneo)) notFound();
  try {
    return await pedir<VistaTorneo>(`/public/clubs/${slug}/torneos/${torneo}`, { base: BASE_SSR });
  } catch (e) {
    if (e instanceof ErrorApi && e.status === 404) notFound();
    throw e;
  }
}

export async function cargarPartido(codigo: string): Promise<PartidoCompartido> {
  if (!/^[0-9a-f]{16}$/.test(codigo)) notFound();
  try {
    return await pedir<PartidoCompartido>(`/public/partidos/${codigo}`, { base: BASE_SSR });
  } catch (e) {
    if (e instanceof ErrorApi && e.status === 404) notFound();
    throw e;
  }
}
