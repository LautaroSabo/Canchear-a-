'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSesion } from '@/componentes/panel/sesion';

/** /panel → agenda del primer club del usuario. */
export default function InicioPanel() {
  const { data } = useSesion();
  const router = useRouter();
  const primero = data?.clubs[0];
  useEffect(() => {
    if (primero) router.replace(`/panel/${primero.id}/agenda`);
  }, [primero, router]);
  if (data && !primero) {
    return (
      <p className="p-6">Tu usuario todavía no tiene un club asignado. Pedile acceso al dueño del club.</p>
    );
  }
  return null;
}
