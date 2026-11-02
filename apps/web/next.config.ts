import type { NextConfig } from 'next';

// Encabezados de seguridad para todas las páginas.
const ENCABEZADOS = [
  // Nadie puede meter el sitio (y el panel) en un iframe ajeno para engañar clics.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // El link del comprobante (/r/<código>) no se filtra a otros sitios por el Referer.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // La cámara solo para el escáner del check-in, en este mismo sitio.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  // Una vez visto por HTTPS, el navegador no vuelve a entrar por HTTP.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

// Sin dominio propio: el navegador le habla a la API en /api de este mismo sitio y Next
// la reenvía por la red interna (API_URL_INTERNA). Mismo origen = la cookie del panel anda
// aunque el hosting dé dos subdominios distintos. Con dominio propio no hace falta.
const API_INTERNA = process.env.API_URL_INTERNA?.replace(/\/$/, '');
const API_EN_ESTE_SITIO = process.env.NEXT_PUBLIC_API_URL?.startsWith('/') ?? false;

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Los e2e compilan en su propia carpeta (con otra URL de API) sin pisar el build normal.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  async rewrites() {
    if (!API_EN_ESTE_SITIO || !API_INTERNA) return [];
    return [{ source: `${process.env.NEXT_PUBLIC_API_URL}/:ruta*`, destination: `${API_INTERNA}/:ruta*` }];
  },
  async headers() {
    return [{ source: '/:ruta*', headers: ENCABEZADOS }];
  },
};

export default config;
