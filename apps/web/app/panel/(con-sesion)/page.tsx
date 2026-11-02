'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSesion } from '@/componentes/panel/sesion';
import { BotonLink } from '@/componentes/ui';

/** /panel → agenda del primer club del usuario (o la administración, si no tiene club). */
export default function InicioPanel() {
  const { data } = useSesion();
  const router = useRouter();
  const primero = data?.clubs[0];
  const superadmin = data?.usuario.esSuperadmin;
  useEffect(() => {
    if (primero) router.replace(`/panel/${primero.id}/agenda`);
    else if (superadmin) router.replace('/panel/plataforma');
  }, [primero, superadmin, router]);
  if (data && !primero && !superadmin) {
    return (
      <main className="mx-auto flex max-w-xl flex-col items-start gap-4 px-6 py-16">
        <h1 className="font-display text-[40px] leading-none font-bold">Todavía no tenés un club</h1>
        <p className="text-base text-tenue">
          Si trabajás en un club, pedile al dueño que te sume desde Configuración → Usuarios. Si sos el dueño,
          registralo.
        </p>
        <BotonLink href="/registrar">Registrar mi club</BotonLink>
      </main>
    );
  }
  return null;
}
