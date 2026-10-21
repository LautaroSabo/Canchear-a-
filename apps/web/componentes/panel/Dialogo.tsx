'use client';

import { useEffect, useRef } from 'react';

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
      aria-labelledby="titulo-dialogo"
      className="m-auto w-[min(520px,calc(100vw-32px))] rounded-2xl bg-white p-0 text-tinta shadow-xl backdrop:bg-black/40"
    >
      {abierto ? (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="titulo-dialogo" className="text-lg font-bold">
              {titulo}
            </h2>
            <button
              type="button"
              onClick={alCerrar}
              aria-label="Cerrar"
              className="flex size-10 items-center justify-center rounded-lg text-suave hover:bg-fondo"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
