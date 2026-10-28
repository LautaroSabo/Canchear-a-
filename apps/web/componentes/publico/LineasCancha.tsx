/**
 * Las líneas de cal de una cancha (mitad y círculo central), recortadas. Es el único adorno
 * del lado público: va detrás del nombre del club, sin texto encima que dependa de él.
 */
export function LineasCancha({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 600 400"
      preserveAspectRatio="xMidYMid slice"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    >
      <g fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M430 -10 V410" />
        <circle cx="430" cy="200" r="120" />
        <circle cx="430" cy="200" r="5" fill="currentColor" />
        <path d="M-10 30 H700 M-10 370 H700" />
      </g>
    </svg>
  );
}
