'use client';

import { Casilla } from '../ui';

/** "Acepto los Términos y la Política de privacidad", con los links en otra pestaña. */
export function AceptoTerminos({
  valor,
  onCambio,
  error,
}: {
  valor: boolean;
  onCambio: (v: boolean) => void;
  error?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Casilla
        name="terminos"
        checked={valor}
        onChange={(e) => onCambio(e.target.checked)}
        aria-invalid={error ? true : undefined}
        etiqueta={
          <span className="font-normal">
            Acepto los{' '}
            <a href="/terminos" target="_blank" rel="noreferrer" className="font-semibold underline">
              Términos
            </a>{' '}
            y la{' '}
            <a href="/privacidad" target="_blank" rel="noreferrer" className="font-semibold underline">
              Política de privacidad
            </a>
          </span>
        }
      />
      {error ? <span className="text-sm font-semibold text-peligro">{error}</span> : null}
    </div>
  );
}
