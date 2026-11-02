import nodemailer from 'nodemailer';

/** Un mail para avisos internos de la plataforma (no a clientes). */
export interface Mail {
  para: string;
  asunto: string;
  texto: string;
}

export interface Correo {
  readonly nombre: string;
  enviar(mail: Mail): Promise<void>;
}

/**
 * Resend por HTTPS (https://resend.com). Funciona en hostings que bloquean SMTP, como
 * Railway en el plan Hobby. Sin dominio verificado, el remitente es onboarding@resend.dev
 * y solo puede mandarle a la dirección de la cuenta de Resend: alcanza para avisarte a vos.
 */
export class CorreoResend implements Correo {
  readonly nombre = 'resend';
  constructor(
    private readonly apiKey: string,
    private readonly remitente = 'Canchería <onboarding@resend.dev>',
  ) {}

  async enviar(m: Mail) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.remitente, to: [m.para], subject: m.asunto, text: m.texto }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

/** SMTP (por ejemplo Gmail con una contraseña de aplicación). */
export class CorreoSmtp implements Correo {
  readonly nombre = 'smtp';
  private readonly transporte;
  constructor(
    o: { host: string; puerto: number; usuario: string; contrasena: string },
    private readonly remitente = `Canchería <${o.usuario}>`,
  ) {
    this.transporte = nodemailer.createTransport({
      host: o.host,
      port: o.puerto,
      secure: o.puerto === 465,
      auth: { user: o.usuario, pass: o.contrasena },
      connectionTimeout: 10_000,
    });
  }

  async enviar(m: Mail) {
    await this.transporte.sendMail({ from: this.remitente, to: m.para, subject: m.asunto, text: m.texto });
  }
}

/** Para tests: guarda lo que se mandó. */
export class CorreoMemoria implements Correo {
  readonly nombre = 'memoria';
  readonly enviados: Mail[] = [];
  async enviar(m: Mail) {
    this.enviados.push(m);
  }
}

export interface ConfigCorreo {
  resendApiKey?: string | undefined;
  remitente?: string | undefined;
  smtp?: { host: string; puerto: number; usuario: string; contrasena: string } | undefined;
}

/** Resend si hay API key; si no, SMTP si está completo; si no, nada. */
export function crearCorreo(c: ConfigCorreo): Correo | null {
  if (c.resendApiKey) return new CorreoResend(c.resendApiKey, c.remitente || undefined);
  if (c.smtp) return new CorreoSmtp(c.smtp, c.remitente || undefined);
  return null;
}
