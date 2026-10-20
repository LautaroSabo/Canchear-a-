/** Códigos SQLSTATE que la app traduce a errores de negocio. */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
  EXCLUSION_VIOLATION: '23P01',
} as const;

interface ErrorPg {
  code: string;
  constraint_name?: string;
}

/** Drizzle envuelve los errores del driver (DrizzleQueryError → cause); recorre la cadena. */
export function errorPg(e: unknown): ErrorPg | undefined {
  for (let actual = e, i = 0; actual && i < 5; actual = (actual as { cause?: unknown }).cause, i++) {
    if (
      typeof actual === 'object' &&
      'code' in actual &&
      typeof actual.code === 'string' &&
      actual.code.length === 5
    ) {
      return actual as ErrorPg;
    }
  }
  return undefined;
}

/** La cancha ya está tomada en ese rango (violó `turnos_sin_solapamiento`). */
export function esTurnoOcupado(e: unknown): boolean {
  const pg = errorPg(e);
  return pg?.code === PG.EXCLUSION_VIOLATION && pg.constraint_name === 'turnos_sin_solapamiento';
}

export function violaUnique(e: unknown, constraint?: string): boolean {
  const pg = errorPg(e);
  return pg?.code === PG.UNIQUE_VIOLATION && (constraint === undefined || pg.constraint_name === constraint);
}
