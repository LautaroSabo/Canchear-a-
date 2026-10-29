/** Texto legible de un error; un AggregateError (p. ej. ECONNREFUSED en ::1 y 127.0.0.1) no trae mensaje propio. */
function mensaje(e: unknown): string {
  if (e instanceof AggregateError && e.errors.length) {
    return [...new Set(e.errors.map(mensaje))].join(' / ');
  }
  if (e instanceof Error) return e.message || (e as { code?: string }).code || e.name;
  return String(e);
}

function codigo(e: unknown): string | undefined {
  if (e instanceof AggregateError) return e.errors.map(codigo).find(Boolean);
  return (e as { code?: string } | null)?.code;
}

/** Corre un comando de CLI mostrando solo el mensaje de error (sin stack) y saliendo con código 1. */
export async function ejecutar(tarea: () => Promise<unknown>) {
  try {
    await tarea();
  } catch (e) {
    console.error(`✖ ${mensaje(e)}`);
    if (codigo(e) === 'ECONNREFUSED') {
      console.error(
        '  No hay ningún Postgres escuchando en la dirección de DATABASE_URL.\n' +
          '  Levantalo con `pnpm db:up` (necesita Docker Desktop abierto) y volvé a probar.',
      );
    }
    process.exitCode = 1;
  }
}
