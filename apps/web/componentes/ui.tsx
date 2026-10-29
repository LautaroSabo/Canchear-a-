'use client';

import Link from 'next/link';
import {
  type ButtonHTMLAttributes,
  type ComponentProps,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
  useRef,
  useState,
} from 'react';

/*
 * Piezas base. Las esquinas son rectas (2px) en todo: botones, campos, tarjetas.
 * Los colores salen de roles del tema (globals.css), así la misma pieza sirve en la
 * noche del lado público y en el panel claro.
 */

type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma' | 'mp';

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-acento text-acento-tinta hover:bg-acento-hover disabled:bg-superficie-2 disabled:text-tenue',
  secundario: 'bg-superficie text-tinta border border-borde-control hover:border-tinta disabled:text-tenue',
  peligro: 'bg-superficie text-peligro border border-error-borde hover:border-peligro',
  fantasma: 'bg-transparent text-acento-texto hover:bg-acento-suave',
  mp: 'bg-mp text-white hover:brightness-110',
};

function clasesBoton(variante: Variante, grande: boolean) {
  return `inline-flex items-center justify-center gap-2 rounded-xs px-4 font-semibold transition-colors disabled:cursor-not-allowed ${
    grande ? 'min-h-13 text-base' : 'min-h-11 text-sm'
  } ${VARIANTES[variante]}`;
}

export function Boton({
  variante = 'primario',
  grande = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; grande?: boolean }) {
  return <button type="button" {...props} className={`${clasesBoton(variante, grande)} ${className}`} />;
}

export function BotonLink({
  variante = 'primario',
  grande = false,
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variante?: Variante; grande?: boolean }) {
  return <Link {...props} className={`${clasesBoton(variante, grande)} ${className}`} />;
}

const CLASE_CONTROL =
  'min-h-11 w-full rounded-xs border border-borde-control bg-superficie px-3 text-base font-normal text-tinta placeholder:text-tenue aria-invalid:border-error-borde';

function Ayudas({
  idAyuda,
  ayuda,
  idError,
  error,
}: {
  idAyuda: string;
  ayuda?: ReactNode;
  idError: string;
  error?: ReactNode;
}) {
  return (
    <>
      {ayuda ? (
        <span id={idAyuda} className="text-sm text-tenue">
          {ayuda}
        </span>
      ) : null}
      {error ? (
        <span id={idError} className="text-sm font-semibold text-peligro">
          {error}
        </span>
      ) : null}
    </>
  );
}

function describedBy(ayuda: ReactNode, idAyuda: string, error: ReactNode, idError: string) {
  return [ayuda ? idAyuda : '', error ? idError : ''].filter(Boolean).join(' ') || undefined;
}

export function Campo({
  etiqueta,
  ayuda,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta: ReactNode; ayuda?: ReactNode; error?: ReactNode }) {
  const idAyuda = useId();
  const idError = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {etiqueta}
        <input
          {...props}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(ayuda, idAyuda, error, idError)}
          className={CLASE_CONTROL}
        />
      </label>
      <Ayudas idAyuda={idAyuda} ayuda={ayuda} idError={idError} error={error} />
    </div>
  );
}

export function Selector({
  etiqueta,
  ayuda,
  error,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: ReactNode; ayuda?: ReactNode; error?: ReactNode }) {
  const idAyuda = useId();
  const idError = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {etiqueta}
        <select
          {...props}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(ayuda, idAyuda, error, idError)}
          className={CLASE_CONTROL}
        >
          {children}
        </select>
      </label>
      <Ayudas idAyuda={idAyuda} ayuda={ayuda} idError={idError} error={error} />
    </div>
  );
}

export function Casilla({
  etiqueta,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { etiqueta: ReactNode }) {
  return (
    <label className="flex min-h-11 items-center gap-2.5 text-sm font-semibold">
      <input type="checkbox" {...props} className="size-5 shrink-0 accent-[var(--acento)]" />
      {etiqueta}
    </label>
  );
}

export function Tarjeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xs border border-linea bg-superficie p-5 ${className}`}>{children}</div>;
}

const AVISOS = {
  error: 'bg-error-fondo border-error-borde text-error-texto',
  info: 'bg-info-fondo border-info-borde text-info-texto',
  ok: 'bg-ok-fondo border-ok-borde text-ok-texto',
  ambar: 'bg-aviso-fondo border-aviso-borde text-aviso-texto',
};

export function Aviso({ tipo = 'error', children }: { tipo?: keyof typeof AVISOS; children: ReactNode }) {
  return (
    <div
      role={tipo === 'error' ? 'alert' : 'status'}
      className={`rounded-xs border px-4 py-3 text-sm ${AVISOS[tipo]}`}
    >
      {children}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-6 text-sm text-tenue">
      <span
        className="size-5 animate-spin rounded-full border-2 border-linea border-t-acento-texto"
        aria-hidden="true"
      />
      {texto}
    </div>
  );
}

export function Numero({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`cifras font-display font-bold leading-none ${className}`}>{children}</span>;
}

/* ---------- Piezas compartidas nuevas ---------- */

export type Tono = 'ok' | 'aviso' | 'info' | 'error' | 'neutro';

const INSIGNIAS: Record<Tono, string> = {
  ok: 'bg-ok-fondo text-ok-texto',
  aviso: 'bg-aviso-fondo text-aviso-texto',
  info: 'bg-info-fondo text-info-texto',
  error: 'bg-error-fondo text-error-texto',
  neutro: 'bg-superficie-2 text-tenue',
};

export function Insignia({
  tono = 'neutro',
  children,
  className = '',
}: {
  tono?: Tono;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-xs px-2 py-0.5 text-sm font-semibold whitespace-nowrap ${INSIGNIAS[tono]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Título de pantalla del panel: un h1, una línea de contexto y las acciones a la derecha. */
export function EncabezadoPagina({
  titulo,
  bajada,
  acciones,
}: {
  titulo: ReactNode;
  bajada?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-[40px] leading-none font-bold">{titulo}</h1>
        {bajada ? <p className="mt-2 text-base text-tenue">{bajada}</p> : null}
      </div>
      {acciones ? <div className="flex flex-wrap items-center gap-2">{acciones}</div> : null}
    </header>
  );
}

export function EstadoVacio({
  titulo,
  children,
  accion,
}: {
  titulo: ReactNode;
  children?: ReactNode;
  accion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 border border-dashed border-borde-control px-5 py-8">
      <p className="text-base font-semibold">{titulo}</p>
      {children ? <p className="max-w-prose text-sm text-tenue">{children}</p> : null}
      {accion ? <div className="mt-2">{accion}</div> : null}
    </div>
  );
}

/** Valor con botón Copiar (alias, CBU, monto). Avisa por aria-live cuando copió. */
export function Copiable({
  etiqueta,
  valor,
  mostrar,
}: {
  etiqueta: string;
  valor: string;
  mostrar?: ReactNode;
}) {
  const [copiado, setCopiado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 border-b border-linea py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm text-tenue">{etiqueta}</p>
        <p className="cifras text-base font-semibold break-all">{mostrar ?? valor}</p>
      </div>
      <button
        type="button"
        onClick={copiar}
        aria-label={`Copiar ${etiqueta.toLowerCase()}`}
        className="min-h-11 min-w-24 shrink-0 rounded-xs border border-borde-control px-3 text-sm font-semibold hover:border-tinta"
      >
        <span aria-live="polite">{copiado ? 'Copiado' : 'Copiar'}</span>
      </button>
    </div>
  );
}

export type Opcion<T extends string> = { valor: T; etiqueta: ReactNode; cuenta?: number };

/**
 * Pestañas accesibles (role=tablist, flechas, Inicio/Fin). El contenido lo pinta quien
 * las usa dentro de un elemento con id `${id}-panel` y role="tabpanel".
 */
export function Pestanas<T extends string>({
  etiqueta,
  opciones,
  valor,
  onCambio,
  id,
}: {
  etiqueta: string;
  opciones: Opcion<T>[];
  valor: T;
  onCambio: (v: T) => void;
  id: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function tecla(e: KeyboardEvent, i: number) {
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % opciones.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + opciones.length) % opciones.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = opciones.length - 1;
    if (j < 0) return;
    e.preventDefault();
    const o = opciones[j];
    if (!o) return;
    onCambio(o.valor);
    refs.current[j]?.focus();
  }
  return (
    <div role="tablist" aria-label={etiqueta} className="flex gap-1 overflow-x-auto border-b border-linea">
      {opciones.map((o, i) => {
        const activa = o.valor === valor;
        return (
          <button
            key={o.valor}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${o.valor}`}
            aria-selected={activa}
            aria-controls={`${id}-panel`}
            tabIndex={activa ? 0 : -1}
            onClick={() => onCambio(o.valor)}
            onKeyDown={(e) => tecla(e, i)}
            className={`-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-[3px] px-3 text-sm font-semibold whitespace-nowrap ${
              activa ? 'border-acento-texto text-tinta' : 'border-transparent text-tenue hover:text-tinta'
            }`}
          >
            {o.etiqueta}
            {o.cuenta ? (
              <span className="cifras rounded-xs bg-aviso-fondo px-1.5 text-sm text-aviso-texto">
                {o.cuenta}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Elección corta entre 2–4 valores (medio de pago, vista Día/Semana). */
export function Segmentado<T extends string>({
  etiqueta,
  opciones,
  valor,
  onCambio,
  className = '',
}: {
  etiqueta: string;
  opciones: Opcion<T>[];
  valor: T;
  onCambio: (v: T) => void;
  className?: string;
}) {
  return (
    <fieldset className={`inline-flex rounded-xs border border-borde-control p-0.5 ${className}`}>
      <legend className="sr-only">{etiqueta}</legend>
      {opciones.map((o) => {
        const activa = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={activa}
            onClick={() => onCambio(o.valor)}
            className={`min-h-10 flex-1 rounded-xs px-3 text-sm font-semibold whitespace-nowrap ${
              activa ? 'bg-tinta text-fondo' : 'text-tenue hover:text-tinta'
            }`}
          >
            {o.etiqueta}
          </button>
        );
      })}
    </fieldset>
  );
}
