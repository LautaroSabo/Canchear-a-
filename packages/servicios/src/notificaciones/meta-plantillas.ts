import { cuerpoMeta, PLANTILLAS, type Plantilla } from './plantillas.ts';

export interface EstadoPlantilla {
  nombre: Plantilla;
  /** APPROVED, PENDING, REJECTED, PAUSED, DISABLED… o FALTA si no está cargada. */
  estado: string;
  categoria: string | null;
  motivoRechazo: string | null;
}

/**
 * Alta y consulta de las plantillas en la cuenta de WhatsApp Business (WABA) por la
 * Graph API, para no tener que copiarlas a mano en el WhatsApp Manager.
 */
export class PlantillasMeta {
  constructor(
    private readonly c: {
      token: string;
      /** ID de la cuenta de WhatsApp Business (no el phone number ID). */
      wabaId: string;
      idioma?: string;
      versionApi?: string;
      fetchFn?: typeof fetch;
    },
  ) {}

  private url() {
    return `https://graph.facebook.com/${this.c.versionApi ?? 'v23.0'}/${this.c.wabaId}/message_templates`;
  }

  private async pedir(url: string, init?: RequestInit) {
    const res = await (this.c.fetchFn ?? fetch)(url, {
      ...init,
      headers: { authorization: `Bearer ${this.c.token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const cuerpo = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & Record<
      string,
      unknown
    >;
    if (!res.ok) throw new Error(`Meta ${res.status}: ${cuerpo.error?.message ?? 'error desconocido'}`);
    return cuerpo;
  }

  async estados(): Promise<EstadoPlantilla[]> {
    const idioma = this.c.idioma ?? 'es_AR';
    const r = (await this.pedir(
      `${this.url()}?fields=name,language,status,category,rejected_reason&limit=200`,
    )) as {
      data?: {
        name: string;
        language: string;
        status: string;
        category?: string;
        rejected_reason?: string;
      }[];
    };
    const cargadas = (r.data ?? []).filter((t) => t.language === idioma);
    return (Object.keys(PLANTILLAS) as Plantilla[]).map((nombre) => {
      const t = cargadas.find((x) => x.name === nombre);
      return {
        nombre,
        estado: t?.status ?? 'FALTA',
        categoria: t?.category ?? null,
        motivoRechazo: t?.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
      };
    });
  }

  /** Crea las que falten (las que ya existen no se tocan) y devuelve el estado de todas. */
  async crearFaltantes() {
    const creadas: Plantilla[] = [];
    for (const e of await this.estados()) {
      if (e.estado !== 'FALTA') continue;
      await this.pedir(this.url(), {
        method: 'POST',
        body: JSON.stringify(definicion(e.nombre, this.c.idioma ?? 'es_AR')),
      });
      creadas.push(e.nombre);
    }
    return { creadas, estados: await this.estados() };
  }
}

/** Lo que se manda a Meta para crear la plantilla (también sirve para cargarla a mano). */
export function definicion(nombre: Plantilla, idioma = 'es_AR') {
  return {
    name: nombre,
    language: idioma,
    // Avisos de un turno que el cliente pidió: "utilidad", no marketing.
    category: 'UTILITY',
    parameter_format: 'positional',
    components: [
      { type: 'BODY', text: cuerpoMeta(nombre), example: { body_text: [[...PLANTILLAS[nombre].ejemplo]] } },
    ],
  };
}
