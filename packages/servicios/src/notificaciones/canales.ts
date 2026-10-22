import { PLANTILLAS, type Plantilla } from './plantillas.ts';

export interface CanalMensajes {
  enviar(destino: string, plantilla: Plantilla, parametros: Record<string, string>): Promise<void>;
}

/** Desarrollo: imprime el mensaje completo. */
export class CanalConsola implements CanalMensajes {
  constructor(private readonly log: (linea: string) => void = console.log) {}
  async enviar(destino: string, plantilla: Plantilla, parametros: Record<string, string>) {
    this.log(`[whatsapp → ${destino}] ${PLANTILLAS[plantilla].texto(parametros)}`);
  }
}

/** Tests: guarda lo enviado; puede simular fallas. */
export class CanalMemoria implements CanalMensajes {
  readonly enviados: { destino: string; plantilla: Plantilla; parametros: Record<string, string> }[] = [];
  fallasPendientes = 0;
  async enviar(destino: string, plantilla: Plantilla, parametros: Record<string, string>) {
    if (this.fallasPendientes > 0) {
      this.fallasPendientes--;
      throw new Error('canal caído (simulado)');
    }
    this.enviados.push({ destino, plantilla, parametros });
  }
}

export interface ConfigWhatsApp {
  token: string;
  /** Phone number ID del número de WhatsApp Business (no el número en sí). */
  phoneNumberId: string;
  versionApi?: string;
  idioma?: string;
  fetchFn?: typeof fetch;
}

/**
 * WhatsApp Cloud API (Meta). Fuera de la ventana de 24 h solo se pueden mandar
 * plantillas aprobadas: cada `Plantilla` se envía como template con su mismo nombre.
 */
export class CanalWhatsApp implements CanalMensajes {
  constructor(private readonly c: ConfigWhatsApp) {}

  async enviar(destino: string, plantilla: Plantilla, parametros: Record<string, string>) {
    const { parametros: orden } = PLANTILLAS[plantilla];
    const fetchFn = this.c.fetchFn ?? fetch;
    const res = await fetchFn(
      `https://graph.facebook.com/${this.c.versionApi ?? 'v23.0'}/${this.c.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.c.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: destino.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: plantilla,
            language: { code: this.c.idioma ?? 'es_AR' },
            components: [
              {
                type: 'body',
                // Meta rechaza parámetros vacíos o con saltos de línea.
                parameters: orden.map((k) => ({
                  type: 'text',
                  text: (parametros[k] ?? '').replace(/\s+/g, ' ').trim() || '-',
                })),
              },
            ],
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
  }
}
