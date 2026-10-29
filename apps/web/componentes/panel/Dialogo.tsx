'use client';

import { useEffect, useId, useRef } from 'react';
import { IconoCerrar } from '../iconos';

/** <dialog> nativo: foco atrapado, Escape y fondo modal sin dependencias. */
export function Dialogo({
  abierto,
  alCerrar,
  titulo,
  children,
}: {
  abierto: boolean;
  alCerrar: () => void;
  titulo: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      onClose={alCerrar}
      aria-labelledby={idTitulo}
      className="m-auto max-h-[90dvh] w-[min(560px,calc(100vw-32px))] overflow-y-auto rounded-xs border border-linea bg-superficie p-0 text-tinta backdrop:bg-black/50 max-sm:mb-0 max-sm:w-full max-sm:max-w-full"
    >
      {abierto ? (
        <div className="flex flex-col gap-4 p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id={idTitulo} className="font-display text-[28px] leading-none font-bold">
              {titulo}
            </h2>
            <button
              type="button"
              onClick={alCerrar}
              aria-label="Cerrar"
              className="flex size-11 shrink-0 items-center justify-center rounded-xs text-tenue hover:bg-fondo hover:text-tinta"
            >
              <IconoCerrar />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
