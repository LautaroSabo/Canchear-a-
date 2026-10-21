import { esTurnoOcupado, type Tx } from '@cancheria/db';
import { canchas, clientes, clubs, listaEspera, pagos, turnos } from '@cancheria/db/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type Ejecutor, linkComprobante } from './entorno.ts';
import { fechaCorta, horaCorta } from './formato.ts';
import { encolarNotificacion } from './notificaciones/encolar.ts';
import type { Plantilla } from './notificaciones/plantillas.ts';

export type ResultadoConfirmacion =
  /** Pasó a CONFIRMADO (desde PRE_RESERVADO, o revivido desde EXPIRADO con el slot libre). */
  | 'CONFIRMADO'
  /** Ya estaba confirmado: webhook repetido o segundo pago. */
  | 'YA_CONFIRMADO'
  /** Venció y otro cliente tomó el horario: hay que devolver el pago. */
  | 'SLOT_PERDIDO'
  | 'CANCELADO';

/** Bloquea la fila del turno: serializa pagos, webhooks y expiraciones sobre el mismo turno. */
export async function bloquearTurno(tx: Tx, turnoId: string) {
  const [turno] = await tx.select().from(turnos).where(eq(turnos.id, turnoId)).for('update');
  return turno ?? null;
}

/**
 * Confirma un turno cuya seña se acreditó. Un PRE_RESERVADO se confirma aunque su
 * expira_en ya haya pasado: si sigue en ese estado es porque nadie más tomó el horario
 * (la expiración perezosa lo habría pasado a EXPIRADO). Un EXPIRADO se intenta revivir
 * dentro de un SAVEPOINT: si la exclusion constraint lo rechaza, el slot se perdió.
 */
export async function confirmarSena(tx: Tx, turnoId: string): Promise<ResultadoConfirmacion> {
  const turno = await bloquearTurno(tx, turnoId);
  if (!turno) throw new Error(`turno ${turnoId} inexistente`);

  switch (turno.estado) {
    case 'CONFIRMADO':
    case 'PRESENTE':
    case 'AUSENTE':
      return 'YA_CONFIRMADO';
    case 'CANCELADO':
      return 'CANCELADO';
    case 'PRE_RESERVADO':
      await tx.update(turnos).set({ estado: 'CONFIRMADO', expiraEn: null }).where(eq(turnos.id, turnoId));
      break;
    case 'EXPIRADO':
      try {
        await tx.transaction(async (sp) => {
          await sp.update(turnos).set({ estado: 'CONFIRMADO', expiraEn: null }).where(eq(turnos.id, turnoId));
        });
      } catch (e) {
        if (esTurnoOcupado(e)) return 'SLOT_PERDIDO';
        throw e;
      }
      break;
  }
  // Si era una oferta de la lista de espera, la inscripción se cumplió.
  await tx
    .update(listaEspera)
    .set({ estado: 'CONVERTIDA' })
    .where(and(eq(listaEspera.ofertaTurnoId, turnoId), eq(listaEspera.estado, 'NOTIFICADA')));
  return 'CONFIRMADO';
}

/** Datos para armar el mensaje de un turno (en la zona horaria del club). */
export async function datosParaMensaje(tx: Ejecutor, turnoId: string, urlWeb: string) {
  const [f] = await tx
    .select({
      clubId: turnos.clubId,
      clienteId: turnos.clienteId,
      inicio: turnos.inicio,
      expiraEn: turnos.expiraEn,
      codigo: turnos.codigoCheckin,
      club: clubs.nombre,
      zona: clubs.zonaHoraria,
      cancha: canchas.nombre,
      telefono: clientes.telefonoE164,
    })
    .from(turnos)
    .innerJoin(clubs, eq(clubs.id, turnos.clubId))
    .innerJoin(canchas, eq(canchas.id, turnos.canchaId))
    .innerJoin(clientes, eq(clientes.id, turnos.clienteId))
    .where(eq(turnos.id, turnoId));
  if (!f) return null;
  return {
    ...f,
    parametros: {
      club: f.club,
      cancha: f.cancha,
      fecha: fechaCorta(f.inicio, f.zona),
      hora: horaCorta(f.inicio, f.zona),
      link: linkComprobante(urlWeb, f.codigo),
      vence: f.expiraEn ? horaCorta(f.expiraEn, f.zona) : '',
    },
  };
}

/** Encola un mensaje sobre un turno para su cliente. */
export async function notificarTurno(
  tx: Ejecutor,
  turnoId: string,
  plantilla: Plantilla,
  urlWeb: string,
  extra: Record<string, string> = {},
) {
  const d = await datosParaMensaje(tx, turnoId, urlWeb);
  if (!d) return; // turnos sin cliente (bloqueos del admin)
  await encolarNotificacion(tx, {
    clubId: d.clubId,
    clienteId: d.clienteId,
    destino: d.telefono,
    plantilla,
    parametros: { ...d.parametros, ...extra },
  });
}

/**
 * Efectos de que uno o más holds hayan vencido (los marque el worker o la expiración
 * perezosa de una reserva nueva): aviso al cliente, el checkout de MP que nunca se pagó
 * se cierra y, si eran ofertas de la lista de espera, esa inscripción queda VENCIDA.
 * Un comprobante de transferencia EN_REVISION se deja: si el club lo aprueba, el turno
 * se intenta revivir (o se devuelve la plata si el horario ya se ocupó).
 */
export async function registrarExpiraciones(tx: Ejecutor, turnoIds: string[], urlWeb: string) {
  if (turnoIds.length === 0) return;
  for (const id of turnoIds) await notificarTurno(tx, id, 'reserva_expirada', urlWeb);
  await tx
    .update(pagos)
    .set({ estado: 'RECHAZADO' })
    .where(
      and(
        inArray(pagos.turnoId, turnoIds),
        eq(pagos.proveedor, 'MERCADO_PAGO'),
        eq(pagos.estado, 'PENDIENTE'),
        isNull(pagos.externalId),
      ),
    );
  await tx
    .update(listaEspera)
    .set({ estado: 'VENCIDA' })
    .where(and(inArray(listaEspera.ofertaTurnoId, turnoIds), eq(listaEspera.estado, 'NOTIFICADA')));
}

export const setActor = (tx: Ejecutor, actor: string) =>
  tx.execute(sql`SELECT set_config('app.actor', ${actor}, true)`);
