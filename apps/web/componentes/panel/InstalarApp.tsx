'use client';

import { useEffect, useState } from 'react';
import { Boton, Tarjeta } from '../ui';

interface EventoInstalar extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * "Instalá el panel en el celular": en Android y en la compu, con el botón del navegador
 * (Chrome/Edge); en iPhone se explica cómo agregarlo a la pantalla de inicio desde Safari.
 */
export function InstalarApp() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  const [instalada, setInstalada] = useState(false);
  const [iphone, setIphone] = useState(false);
  useEffect(() => {
    setInstalada(window.matchMedia('(display-mode: standalone)').matches);
    setIphone(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const guardar = (e: Event) => {
      e.preventDefault();
      setEvento(e as EventoInstalar);
    };
    const listo = () => setInstalada(true);
    window.addEventListener('beforeinstallprompt', guardar);
    window.addEventListener('appinstalled', listo);
    return () => {
      window.removeEventListener('beforeinstallprompt', guardar);
      window.removeEventListener('appinstalled', listo);
    };
  }, []);

  if (instalada) return null;
  return (
    <Tarjeta className="flex flex-col gap-2">
      <h2 className="text-lg font-bold">Tené el panel como app</h2>
      <p className="text-sm text-tenue">
        Queda un ícono en la pantalla del celular y se abre directo en la agenda, a pantalla completa. Ideal
        para el celular o la tablet de la recepción.
      </p>
      {evento ? (
        <div>
          <Boton
            onClick={async () => {
              await evento.prompt();
              const r = await evento.userChoice;
              if (r.outcome === 'accepted') setInstalada(true);
              setEvento(null);
            }}
          >
            Instalar el panel
          </Boton>
        </div>
      ) : iphone ? (
        <p className="text-sm">
          En el iPhone: abrí el panel en <strong>Safari</strong>, tocá el botón <strong>Compartir</strong> (el
          cuadrado con la flecha) y elegí <strong>Agregar a inicio</strong>.
        </p>
      ) : (
        <p className="text-sm">
          En Android: en <strong>Chrome</strong>, menú <strong>⋮</strong> → <strong>Instalar app</strong> (o{' '}
          <strong>Agregar a la pantalla principal</strong>). En la compu, el ícono de instalar en la barra de
          direcciones.
        </p>
      )}
    </Tarjeta>
  );
}
