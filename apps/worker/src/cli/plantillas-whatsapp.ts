/**
 * Plantillas de WhatsApp en Meta.
 *
 *   pnpm whatsapp:plantillas            muestra cada plantilla lista para cargar a mano
 *   pnpm whatsapp:plantillas estado     estado en Meta (aprobada, pendiente, rechazada)
 *   pnpm whatsapp:plantillas crear      crea en Meta las que falten
 *
 * `estado` y `crear` usan WHATSAPP_TOKEN y WHATSAPP_WABA_ID del entorno.
 */
import { cuerpoMeta, definicion, PLANTILLAS, type Plantilla, PlantillasMeta } from '@cancheria/servicios';

const ESTADOS: Record<string, string> = {
  APPROVED: '✅ aprobada',
  PENDING: '⏳ en revisión',
  REJECTED: '❌ rechazada',
  PAUSED: '⏸ pausada',
  DISABLED: '⛔ deshabilitada',
  FALTA: '·  no está cargada',
};

const comando = process.argv[2] ?? 'listar';

if (comando === 'listar') {
  for (const nombre of Object.keys(PLANTILLAS) as Plantilla[]) {
    const d = definicion(nombre);
    console.log(`\n── ${nombre}`);
    console.log('Categoría: Utilidad · Idioma: Spanish (ARG) · es_AR');
    console.log(`Cuerpo:\n${cuerpoMeta(nombre)}`);
    console.log(
      `Ejemplos: ${d.components[0]?.example.body_text[0]?.map((v, i) => `{{${i + 1}}} = ${v}`).join(' · ')}`,
    );
  }
} else if (comando === 'estado' || comando === 'crear') {
  const token = process.env.WHATSAPP_TOKEN;
  const wabaId = process.env.WHATSAPP_WABA_ID;
  if (!token || !wabaId) {
    console.error('Faltan WHATSAPP_TOKEN y WHATSAPP_WABA_ID (ver docs/whatsapp.md).');
    process.exit(1);
  }
  const meta = new PlantillasMeta({ token, wabaId });
  try {
    let estados = await meta.estados();
    if (comando === 'crear') {
      const r = await meta.crearFaltantes();
      console.log(r.creadas.length ? `Creadas: ${r.creadas.join(', ')}` : 'No faltaba ninguna.');
      estados = r.estados;
    }
    for (const e of estados) {
      console.log(
        `${(ESTADOS[e.estado] ?? e.estado).padEnd(20)} ${e.nombre}${e.motivoRechazo ? ` (motivo: ${e.motivoRechazo})` : ''}`,
      );
    }
    if (estados.some((e) => e.categoria && e.categoria !== 'UTILITY')) {
      console.log(
        '\nAtención: Meta reclasificó alguna como MARKETING; cuesta más por mensaje. Revisalo en WhatsApp Manager.',
      );
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else {
  console.error(`Comando desconocido: ${comando}. Usá listar, estado o crear.`);
  process.exit(1);
}
