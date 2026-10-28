const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** 4500000 centavos → "$45.000" (separador de miles a mano: no depende de la versión de ICU). */
export function pesos(centavos: number): string {
  const entero = Math.round(centavos / 100);
  return `${entero < 0 ? '−' : ''}$${String(Math.abs(entero)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

const formatos = new Map<string, Intl.DateTimeFormat>();
function formato(zona: string, clave: string, opciones: Intl.DateTimeFormatOptions) {
  const k = `${zona}|${clave}`;
  let f = formatos.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zona, ...opciones });
    formatos.set(k, f);
  }
  return f;
}

function partes(iso: string | Date, zona: string) {
  const p = Object.fromEntries(
    formato(zona, 'partes', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(typeof iso === 'string' ? new Date(iso) : iso)
      .map((x) => [x.type, x.value]),
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

/** "20:00" en la zona del club. */
export const hora = (iso: string | Date, zona: string) => partes(iso, zona).hora;

/** "2030-01-05": fecha local del club para un instante. */
export const fechaLocal = (iso: string | Date, zona: string) => partes(iso, zona).fecha;

/** Hoy en la zona del club. */
export const hoyEn = (zona: string, ahora: Date = new Date()) => fechaLocal(ahora, zona);

const aUtc = (ymd: string) => {
  const [a, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d));
};

export const sumarDias = (ymd: string, n: number) => {
  const d = aUtc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const diaSemana = (ymd: string) => aUtc(ymd).getUTCDay();

/** "Sábado 24/10". */
export function fechaCorta(ymd: string) {
  const [, m, d] = ymd.split('-');
  return `${DIAS[diaSemana(ymd)]} ${d}/${m}`;
}

/** "Sábado 24 de octubre". */
export function fechaLarga(ymd: string) {
  const [, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return `${DIAS[diaSemana(ymd)]} ${d} de ${MESES[m - 1]}`;
}

/** Chips de días: { fecha, nombre: "Sáb", numero: "24" }. */
export function proximosDias(desde: string, cantidad: number) {
  return Array.from({ length: cantidad }, (_, i) => {
    const fecha = sumarDias(desde, i);
    return { fecha, nombre: i === 0 ? 'Hoy' : (DIAS_CORTOS[diaSemana(fecha)] ?? ''), numero: fecha.slice(8) };
  });
}

/** "+5491155551234" → "+54 9 11 5555-1234" (si es un celular de AMBA; si no, tal cual). */
export function telefonoLegible(e164: string) {
  const m = e164.match(/^\+549(11)(\d{4})(\d{4})$/);
  return m ? `+54 9 ${m[1]} ${m[2]}-${m[3]}` : e164;
}

export const linkWhatsApp = (e164: string) => `https://wa.me/${e164.replace(/\D/g, '')}`;

/** Segundos que faltan hasta `iso` (nunca negativo). */
export const segundosHasta = (iso: string, ahora = Date.now()) =>
  Math.max(0, Math.floor((Date.parse(iso) - ahora) / 1000));

/** 125 → "02:05". */
export const reloj = (segundos: number) =>
  `${String(Math.floor(segundos / 60)).padStart(2, '0')}:${String(segundos % 60).padStart(2, '0')}`;

function offsetMinutos(instante: Date, zona: string) {
  const p = Object.fromEntries(
    formato(zona, 'offset', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instante)
      .map((x) => [x.type, x.value]),
  );
  const comoUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
  );
  return Math.round((comoUtc - Math.floor(instante.getTime() / 60_000) * 60_000) / 60_000);
}

/** "2030-01-05" + "20:00" en la zona del club → ISO UTC (para cargar turnos a mano). */
export function instanteLocal(ymd: string, hhmm: string, zona: string): string {
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const ingenuo = aUtc(ymd).getTime() + (h * 60 + mi) * 60_000;
  const offset = offsetMinutos(new Date(ingenuo), zona);
  const corregido = offsetMinutos(new Date(ingenuo - offset * 60_000), zona);
  return new Date(ingenuo - corregido * 60_000).toISOString();
}

/** "La Canchita F5" → "LC" (palabras que empiezan con letra). */
export const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter((p) => /^\p{L}/u.test(p))
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/** "2026-10-28" → "octubre". */
export const nombreMes = (ymd: string) => MESES[Number(ymd.slice(5, 7)) - 1] ?? '';
