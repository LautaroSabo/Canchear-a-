const formatosFecha = new Map<string, Intl.DateTimeFormat>();
const formatosHora = new Map<string, Intl.DateTimeFormat>();

function cacheado(
  mapa: Map<string, Intl.DateTimeFormat>,
  zona: string,
  opciones: Intl.DateTimeFormatOptions,
) {
  let f = mapa.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('es-AR', { timeZone: zona, ...opciones });
    mapa.set(zona, f);
  }
  return f;
}

/** "sáb 05/01" en la zona del club. Se arma por partes: el separador de ICU cambia entre versiones. */
export function fechaCorta(d: Date, zona: string) {
  const p = Object.fromEntries(
    cacheado(formatosFecha, zona, { weekday: 'short', day: '2-digit', month: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.weekday?.replace('.', '')} ${p.day}/${p.month}`;
}

/** "20:00" en la zona del club. */
export const horaCorta = (d: Date, zona: string) =>
  cacheado(formatosHora, zona, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

/** 2250000 centavos → "$22.500". */
export const pesos = (centavos: number) =>
  `$${(centavos / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
