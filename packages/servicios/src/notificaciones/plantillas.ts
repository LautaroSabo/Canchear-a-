/**
 * Mensajes al cliente. En WhatsApp cada plantilla tiene que estar aprobada por Meta con
 * el mismo nombre, idioma es_AR y los parámetros {{1}}, {{2}}… en el orden de `parametros`.
 * `texto` es la versión completa: se usa en SMS, en el canal de consola (desarrollo) y
 * como referencia para cargar la plantilla en Meta.
 */
export const PLANTILLAS = {
  reserva_confirmada: {
    parametros: ['club', 'cancha', 'fecha', 'hora', 'link'],
    texto: (p: Record<string, string>) =>
      `✅ ${p.club}: tu turno en ${p.cancha} el ${p.fecha} a las ${p.hora} está confirmado. Comprobante y QR: ${p.link}`,
  },
  reserva_expirada: {
    parametros: ['club', 'fecha', 'hora'],
    texto: (p: Record<string, string>) =>
      `⌛ ${p.club}: venció el plazo para confirmar tu turno del ${p.fecha} a las ${p.hora} y la cancha quedó libre.`,
  },
  reserva_cancelada: {
    parametros: ['club', 'fecha', 'hora', 'motivo', 'reembolso'],
    texto: (p: Record<string, string>) =>
      `❌ ${p.club}: se canceló tu turno del ${p.fecha} a las ${p.hora} (${p.motivo}). ${p.reembolso}`,
  },
  pago_reembolsado: {
    parametros: ['club', 'monto', 'motivo'],
    texto: (p: Record<string, string>) =>
      `↩️ ${p.club}: te devolvemos ${p.monto} por Mercado Pago (${p.motivo}). Puede tardar unos días en verse.`,
  },
  transferencia_rechazada: {
    parametros: ['club', 'motivo', 'link'],
    texto: (p: Record<string, string>) =>
      `⚠️ ${p.club}: no pudimos validar tu comprobante (${p.motivo}). Podés subir otro o pagar con Mercado Pago: ${p.link}`,
  },
  oferta_lista_espera: {
    parametros: ['club', 'cancha', 'fecha', 'hora', 'vence', 'link'],
    texto: (p: Record<string, string>) =>
      `🎉 ${p.club}: se liberó ${p.cancha} el ${p.fecha} a las ${p.hora}. Te lo guardamos hasta las ${p.vence}: ${p.link}`,
  },
  turno_fijo_creado: {
    parametros: ['club', 'cancha', 'dia', 'hora', 'desde'],
    texto: (p: Record<string, string>) =>
      `📅 ${p.club}: quedó agendado tu turno fijo en ${p.cancha}, ${p.dia} a las ${p.hora}, desde el ${p.desde}. Si una semana no pueden venir, avisanos.`,
  },
} as const;

export type Plantilla = keyof typeof PLANTILLAS;

export const MOTIVOS_REEMBOLSO: Record<string, string> = {
  PAGO_TARDIO: 'el pago llegó cuando el turno ya estaba tomado',
  PAGO_DUPLICADO: 'la seña ya estaba pagada',
  MONTO_INSUFICIENTE: 'el monto no alcanzaba la seña',
  TURNO_CANCELADO: 'el turno estaba cancelado',
};
