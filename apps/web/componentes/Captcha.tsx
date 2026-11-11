'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

// Cloudflare Turnstile: casi siempre invisible (a veces muestra un tilde). Sin clave
// configurada (NEXT_PUBLIC_TURNSTILE_SITE_KEY) no se muestra nada y la API no lo pide.
const CLAVE = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

interface Turnstile {
  render(el: HTMLElement, o: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let script: Promise<void> | null = null;
function cargarScript() {
  script ??= new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => {
      script = null;
      mal(new Error('no cargó el captcha'));
    };
    document.head.appendChild(s);
  });
  return script;
}

/**
 * `listo`: se puede enviar (hay token, o el captcha no está configurado).
 * `cabeceras`: van en la request. `reiniciar()`: después de un envío (cada token sirve una vez).
 */
export function useCaptcha(): {
  listo: boolean;
  cabeceras: Record<string, string>;
  widget: ReactNode;
  reiniciar: () => void;
} {
  const [token, setToken] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);

  useEffect(() => {
    if (!CLAVE || !ref.current) return;
    let vivo = true;
    cargarScript()
      .then(() => {
        if (!vivo || !ref.current || !window.turnstile) return;
        id.current = window.turnstile.render(ref.current, {
          sitekey: CLAVE,
          language: 'es',
          theme: 'auto',
          callback: (t: string) => setToken(t),
          'expired-callback': () => setToken(null),
          'error-callback': () => setToken(null),
        });
      })
      .catch(() => setToken(null));
    return () => {
      vivo = false;
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
    };
  }, []);

  const reiniciar = useCallback(() => {
    setToken(null);
    if (id.current) window.turnstile?.reset(id.current);
  }, []);

  return {
    listo: !CLAVE || Boolean(token),
    cabeceras: token ? { 'x-captcha': token } : {},
    widget: CLAVE ? <div ref={ref} className="min-h-[65px]" /> : null,
    reiniciar,
  };
}
