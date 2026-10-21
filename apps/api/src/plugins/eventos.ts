import { EventEmitter } from 'node:events';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
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

const LATIDO_SSE_MS = 25_000;

/**
 * Streams Server-Sent Events abiertos (público y panel). El evento no lleva datos
 * personales: ante cada uno, el front vuelve a pedir la grilla o la agenda de ese día.
 */
export class StreamsSse {
  private readonly abiertos = new Set<() => void>();

  constructor(private readonly bus: BusTurnos) {}

  abrir(req: FastifyRequest, reply: FastifyReply, clubId: string) {
    reply.hijack();
    const res = reply.raw;
    // CORS lo agrega Fastify en la reply; con hijack hay que copiarlo a mano.
    const heredados = Object.entries(reply.getHeaders()).filter(
      (h): h is [string, string | number | string[]] => h[1] !== undefined,
    );
    res.writeHead(200, {
      ...Object.fromEntries(heredados),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const desuscribir = this.bus.suscribir(clubId, (e) => {
      res.write(
        `event: turno\ndata: ${JSON.stringify({ canchaId: e.canchaId, inicio: e.inicio, estado: e.estado })}\n\n`,
      );
    });
    const latido = setInterval(() => res.write(': ping\n\n'), LATIDO_SSE_MS);
    const cerrar = () => {
      if (!this.abiertos.delete(cerrar)) return;
      clearInterval(latido);
      desuscribir();
      res.end();
    };
    this.abiertos.add(cerrar);
    req.raw.on('close', cerrar);
  }

  cerrarTodos() {
    for (const cerrar of this.abiertos) cerrar();
  }
}
