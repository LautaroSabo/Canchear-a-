/** Corre un comando de CLI mostrando solo el mensaje de error (sin stack) y saliendo con código 1. */
export async function ejecutar(tarea: () => Promise<unknown>) {
  try {
    await tarea();
  } catch (e) {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
