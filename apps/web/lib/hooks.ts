'use client';

import { useEffect, useRef, useState } from 'react';

/** `Date.now()` que se actualiza cada `cadaMs` (timers de seña, línea de "ahora"). */
export function useAhora(cadaMs = 1000) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(t);
  }, [cadaMs]);
  return ahora;
}

/**
 * Escucha los eventos SSE de turnos (`event: turno`). El evento no trae datos personales:
 * quien lo usa vuelve a pedir la grilla o la agenda. El navegador reconecta solo.
 */
export function useEventosTurnos(
  url: string | null,
  alCambiar: () => void,
  { conCredenciales = false } = {},
) {
  const callback = useRef(alCambiar);
  callback.current = alCambiar;
  useEffect(() => {
    if (!url || typeof EventSource === 'undefined') return;
    const fuente = new EventSource(url, { withCredentials: conCredenciales });
    const manejar = () => callback.current();
    fuente.addEventListener('turno', manejar);
    return () => {
      fuente.removeEventListener('turno', manejar);
      fuente.close();
    };
  }, [url, conCredenciales]);
}
