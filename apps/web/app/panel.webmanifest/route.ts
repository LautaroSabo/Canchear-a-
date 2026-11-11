// Manifest del panel como app instalable (ver app/panel/layout.tsx).
export function GET() {
  return Response.json(
    {
      name: 'Canchería · Panel',
      short_name: 'Canchería',
      description: 'Agenda, check-in, cobros y caja de tu club.',
      id: '/panel',
      start_url: '/panel',
      scope: '/panel',
      display: 'standalone',
      orientation: 'any',
      background_color: '#0c1611',
      theme_color: '#0c1611',
      lang: 'es',
      icons: [
        { src: '/iconos/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/iconos/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/iconos/icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts: [
        { name: 'Agenda', url: '/panel' },
        { name: 'Check-in', url: '/panel?ir=checkin' },
      ],
    },
    { headers: { 'content-type': 'application/manifest+json' } },
  );
}
