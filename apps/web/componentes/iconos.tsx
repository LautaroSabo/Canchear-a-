// Íconos de trazo (decorativos: aria-hidden). Los botones que solo tienen ícono llevan aria-label.
type P = { className?: string; tamano?: number };

const base = (tamano = 20) => ({
  width: tamano,
  height: tamano,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconoWhatsApp = ({ className, tamano }: P) => (
  <svg aria-hidden="true" {...base(tamano)} className={className}>
    <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z" />
  </svg>
);
export const IconoReloj = ({ className, tamano }: P) => (
  <svg aria-hidden="true" {...base(tamano)} className={className}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2 2M9 2h6" />
  </svg>
);
export const IconoCheck = ({ className, tamano }: P) => (
  <svg aria-hidden="true" {...base(tamano)} strokeWidth={2.4} className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M7.5 12.5l3 3 6-6.5" />
  </svg>
);
export const IconoIzquierda = ({ className, tamano }: P) => (
  <svg aria-hidden="true" {...base(tamano)} className={className}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
export const IconoDerecha = ({ className, tamano }: P) => (
  <svg aria-hidden="true" {...base(tamano)} className={className}>
    <path d="M9 18l6-6-6-6" />
  </svg>
);
export const IconoSubir = ({ className, tamano }: P) => (
  <svg aria-hidden="true" {...base(tamano)} className={className}>
    <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
  </svg>
);
export const IconoEscanear = ({ className, tamano }: P) => (
  <svg aria-hidden="true" {...base(tamano)} className={className}>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" />
  </svg>
);
export const IconoAlerta = ({ className, tamano }: P) => (
  <svg aria-hidden="true" {...base(tamano)} className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v5M12 16.5v.5" />
  </svg>
);
