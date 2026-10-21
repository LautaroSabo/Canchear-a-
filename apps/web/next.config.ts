import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Los e2e compilan en su propia carpeta (con otra URL de API) sin pisar el build normal.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default config;
