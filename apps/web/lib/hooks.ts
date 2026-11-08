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

/**
 * `false` en el HTML del servidor y `true` apenas React toma la página. Sirve para dejar
 * deshabilitado el botón de un formulario hasta que el envío lo maneje JavaScript: si no,
 * un toque rápido en una conexión lenta manda el formulario "a la vieja" y se pierde lo escrito.
 */
export function useHidratado() {
  const [listo, setListo] = useState(false);
  useEffect(() => setListo(true), []);
  return listo;
}
