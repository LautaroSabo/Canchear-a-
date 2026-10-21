export interface Tarea {
  nombre: string;
  cadaMs: number;
  ejecutar: () => Promise<unknown>;
}

interface Logger {
  debug(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/**
 * Corre cada tarea cada `cadaMs`, contado desde que termina la corrida anterior: una
 * tarea nunca se solapa consigo misma. Un error se loguea y la tarea sigue en la próxima
 * vuelta. `detener()` espera a que terminen las corridas en curso (apagado ordenado).
 * Varias instancias del worker pueden correr a la vez: las tareas reclaman trabajo con
 * FOR UPDATE SKIP LOCKED.
 */
export class Programador {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly enCurso = new Set<Promise<void>>();
  private detenido = false;

  constructor(
    private readonly tareas: Tarea[],
    private readonly log: Logger,
  ) {}

  iniciar() {
    for (const tarea of this.tareas) void this.vuelta(tarea);
  }

  private async vuelta(tarea: Tarea) {
    if (this.detenido) return;
    const corrida = this.correr(tarea);
    this.enCurso.add(corrida);
    await corrida;
    this.enCurso.delete(corrida);
    if (!this.detenido)
      this.timers.set(
        tarea.nombre,
        setTimeout(() => void this.vuelta(tarea), tarea.cadaMs),
      );
  }

  private async correr(tarea: Tarea) {
    const inicio = Date.now();
    try {
      const resultado = await tarea.ejecutar();
      this.log.debug({ tarea: tarea.nombre, ms: Date.now() - inicio, resultado }, 'tarea ok');
    } catch (err) {
      this.log.error({ err, tarea: tarea.nombre }, 'tarea falló');
    }
  }

  async detener() {
    this.detenido = true;
    for (const t of this.timers.values()) clearTimeout(t);
    await Promise.all(this.enCurso);
  }
}
