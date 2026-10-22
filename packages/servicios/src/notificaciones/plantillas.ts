/**
 * Mensajes al cliente. En WhatsApp cada plantilla tiene que estar aprobada por Meta con
 * el mismo nombre, idioma es_AR y los parámetros {{1}}, {{2}}… en el orden de `parametros`.
 * `texto` es la versión completa: se usa en SMS, en el canal de consola (desarrollo) y
 * como referencia para cargar la plantilla en Meta.
 */
export const PLANTILLAS = {
  reserva_confirmada: {
    parametros: ['club', 'cancha', 'fecha', 'hora', 'link'],
    ejemplo: ['La Canchita F5', 'Cancha 2', 'sáb 24/10', '20:00', 'https://cancheria.app/r/4f9c2a7e'],
    texto: (p: Record<string, string>) =>
      `✅ Turno confirmado en ${p.club}. Te esperamos en la ${p.cancha} el ${p.fecha} a las ${p.hora}. Tu comprobante con el QR para entrar: ${p.link} (mostralo al llegar).`,
  },
  reserva_expirada: {
    parametros: ['club', 'fecha', 'hora'],
    ejemplo: ['La Canchita F5', 'sáb 24/10', '20:00'],
    texto: (p: Record<string, string>) =>
      `⌛ Venció el plazo para confirmar tu turno en ${p.club} del ${p.fecha} a las ${p.hora}, y la cancha quedó libre. Si querés, podés reservar de nuevo.`,
  },
  reserva_cancelada: {
    parametros: ['club', 'fecha', 'hora', 'motivo', 'reembolso'],
    ejemplo: ['La Canchita F5', 'sáb 24/10', '20:00', 'lluvia', 'te devolvemos $22.500'],
    texto: (p: Record<string, string>) =>
      `❌ Se canceló tu turno en ${p.club} del ${p.fecha} a las ${p.hora}. Motivo: ${p.motivo}. Sobre la seña: ${p.reembolso}. Cualquier duda, comunicate con el club.`,
  },
  pago_reembolsado: {
    parametros: ['club', 'monto', 'motivo'],
    ejemplo: ['La Canchita F5', '$22.500', 'el turno estaba cancelado'],
    texto: (p: Record<string, string>) =>
      `↩️ Devolución de ${p.club}: te devolvemos ${p.monto} por Mercado Pago, porque ${p.motivo}. Puede tardar unos días en verse en tu cuenta.`,
  },
  transferencia_rechazada: {
    parametros: ['club', 'motivo', 'link'],
    ejemplo: ['La Canchita F5', 'el monto no coincide', 'https://cancheria.app/r/4f9c2a7e'],
    texto: (p: Record<string, string>) =>
      `⚠️ No pudimos validar tu comprobante en ${p.club}. Motivo: ${p.motivo}. Podés subir otro o pagar con Mercado Pago desde ${p.link} antes de que venza el plazo.`,
  },
  oferta_lista_espera: {
    parametros: ['club', 'cancha', 'fecha', 'hora', 'vence', 'link'],
    ejemplo: [
      'La Canchita F5',
      'Cancha 2',
      'sáb 24/10',
      '20:00',
      '18:30',
      'https://cancheria.app/r/4f9c2a7e',
    ],
    texto: (p: Record<string, string>) =>
      `🎉 Se liberó un turno en ${p.club}: la ${p.cancha}, el ${p.fecha} a las ${p.hora}. Te lo guardamos hasta las ${p.vence}. Para quedártelo entrá a ${p.link} antes de esa hora.`,
  },
  turno_fijo_creado: {
    parametros: ['club', 'cancha', 'dia', 'hora', 'desde'],
    ejemplo: ['La Canchita F5', 'Cancha 1', 'martes', '20:00', 'mar 03/11'],
    texto: (p: Record<string, string>) =>
      `📅 Quedó agendado tu turno fijo en ${p.club}: la ${p.cancha}, los ${p.dia} a las ${p.hora}, desde el ${p.desde}. Si una semana no pueden venir, avisale al club con tiempo.`,
  },
} as const;

export type Plantilla = keyof typeof PLANTILLAS;

export const MOTIVOS_REEMBOLSO: Record<string, string> = {
  PAGO_TARDIO: 'el pago llegó cuando el turno ya estaba tomado',
  PAGO_DUPLICADO: 'la seña ya estaba pagada',
  MONTO_INSUFICIENTE: 'el monto no alcanzaba la seña',
  TURNO_CANCELADO: 'el turno estaba cancelado',
};

/** Texto de la plantilla como se carga en Meta: cada parámetro como {{1}}, {{2}}… en orden. */
export function cuerpoMeta(plantilla: Plantilla) {
  const { parametros, texto } = PLANTILLAS[plantilla];
  return texto(Object.fromEntries(parametros.map((k, i) => [k, `{{${i + 1}}}`])));
}

/**
 * Reglas de revisión de Meta para el cuerpo de una plantilla. Si alguna falla, Meta la
 * rechaza (o la manda a revisión manual): mejor enterarse en un test que en producción.
 */
export function problemasMeta(cuerpo: string): string[] {
  const problemas: string[] = [];
  const variables = [...cuerpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  if (cuerpo.length > 1024) problemas.push('el cuerpo pasa los 1024 caracteres');
  if (variables.some((n, i) => n !== i + 1))
    problemas.push('las variables tienen que ir {{1}}, {{2}}… en orden y sin saltos');
  if (/^[^\p{L}\p{N}]*\{\{\d+\}\}/u.test(cuerpo)) problemas.push('no puede empezar con una variable');
  if (/\{\{\d+\}\}[^\p{L}\p{N}]*$/u.test(cuerpo)) problemas.push('no puede terminar con una variable');
  if (/\{\{\d+\}\}[^\p{L}\p{N}{]*\{\{\d+\}\}/u.test(cuerpo))
    problemas.push('dos variables seguidas, sin palabras entre ellas');
  const palabras = cuerpo
    .replace(/\{\{\d+\}\}/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  if (palabras < 2 * variables.length + 1) problemas.push('demasiadas variables para tan poco texto');
  return problemas;
}
