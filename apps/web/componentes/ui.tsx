import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
} from 'react';

type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma' | 'mp';

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-cancha text-white hover:bg-cancha-oscuro disabled:bg-borde disabled:text-medio',
  secundario: 'bg-white text-tinta border-[1.5px] border-borde hover:border-medio disabled:text-suave',
  peligro: 'bg-white text-rojo border-[1.5px] border-rojo-borde hover:border-rojo',
  fantasma: 'bg-transparent text-cancha hover:bg-cancha-claro',
  mp: 'bg-mp text-white hover:brightness-95',
};

export function Boton({
  variante = 'primario',
  grande = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; grande?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 font-bold transition disabled:cursor-not-allowed ${
        grande ? 'min-h-13 text-base' : 'min-h-11 text-sm'
      } ${VARIANTES[variante]} ${className}`}
    />
  );
}

export function Campo({
  etiqueta,
  ayuda,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta: ReactNode; ayuda?: ReactNode }) {
  const idAyuda = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {etiqueta}
        <input
          {...props}
          aria-describedby={ayuda ? idAyuda : undefined}
          className="min-h-11 rounded-xl border border-[#c9d1cb] bg-white px-3 text-base font-normal placeholder:text-[#8a948e]"
        />
      </label>
      {ayuda ? (
        <span id={idAyuda} className="text-[13px] text-suave">
          {ayuda}
        </span>
      ) : null}
    </div>
  );
}

export function Selector({
  etiqueta,
  ayuda,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: ReactNode; ayuda?: ReactNode }) {
  const idAyuda = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {etiqueta}
        <select
          {...props}
          aria-describedby={ayuda ? idAyuda : undefined}
          className="min-h-11 rounded-xl border border-[#c9d1cb] bg-white px-3 text-base font-normal"
        >
          {children}
        </select>
      </label>
      {ayuda ? (
        <span id={idAyuda} className="text-[13px] text-suave">
          {ayuda}
        </span>
      ) : null}
    </div>
  );
}

export function Casilla({
  etiqueta,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { etiqueta: ReactNode }) {
  return (
    <label className="flex min-h-11 items-center gap-2.5 text-sm font-semibold">
      <input type="checkbox" {...props} className="size-5 accent-cancha" />
      {etiqueta}
    </label>
  );
}

export function Tarjeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-linea bg-white p-5 ${className}`}>{children}</div>;
}

export function Aviso({
  tipo = 'error',
  children,
}: {
  tipo?: 'error' | 'info' | 'ok' | 'ambar';
  children: ReactNode;
}) {
  const estilos = {
    error: 'bg-[#fdecea] border-[#f1b5ab] text-[#7a1a0c]',
    info: 'bg-azul-fondo border-[#9cc3e4] text-azul-texto',
    ok: 'bg-cancha-suave border-[#9fd3b2] text-cancha-oscuro',
    ambar: 'bg-ambar-fondo border-[#e8b04b] text-ambar-texto',
  }[tipo];
  return (
    <div
      role={tipo === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-4 py-3 text-sm ${estilos}`}
    >
      {children}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-6 text-sm text-suave">
      <span
        className="size-5 animate-spin rounded-full border-2 border-linea border-t-cancha"
        aria-hidden="true"
      />
      {texto}
    </div>
  );
}

export function Numero({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-display font-bold leading-none ${className}`}>{children}</span>;
}
