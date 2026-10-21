import { EventEmitter } from 'node:events';
import type { FastifyBaseLogger } from 'fastify';
import type postgres from 'postgres';

/** Lo que el trigger `turnos_after_change` publica en el canal `turnos` (sin datos personales). */
export interface EventoTurno {
  clubId: string;
  canchaId: string;
  inicio: string;
  estado: string;
}

/**
 * Bus en memoria: una sola conexión LISTEN por proceso y fan-out por club a las
 * conexiones SSE. Con varias instancias de la API cada una escucha por su cuenta,
 * así que no hace falta Redis hasta tener muchas réplicas.
 */
export class BusTurnos {
  private readonly emisor = new EventEmitter().setMaxListeners(0);

  suscribir(clubId: string, fn: (e: EventoTurno) => void): () => void {
    this.emisor.on(clubId, fn);
    return () => this.emisor.off(clubId, fn);
  }

  emitir(e: EventoTurno) {
    this.emisor.emit(e.clubId, e);
  }

  async escuchar(cliente: postgres.Sql, log: FastifyBaseLogger): Promise<() => Promise<void>> {
    const { unlisten } = await cliente.listen('turnos', (payload) => {
      try {
        const p = JSON.parse(payload) as {
          club_id: string;
          cancha_id: string;
          inicio: string;
          estado: string;
        };
        this.emitir({
          clubId: p.club_id,
          canchaId: p.cancha_id,
          inicio: new Date(p.inicio).toISOString(),
          estado: p.estado,
        });
      } catch (err) {
        log.warn({ err, payload }, 'evento de turnos inválido');
      }
    });
    return unlisten;
  }
}
