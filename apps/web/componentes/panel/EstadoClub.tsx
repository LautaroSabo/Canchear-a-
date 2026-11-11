'use client';

import Link from 'next/link';
import { fechaLarga, hoyEn, pesos, sumarDias } from '@/lib/formato';
import { Aviso } from '../ui';
import { alcanza, useClubActual, useSesion } from './sesion';

/** Días antes del vencimiento del abono en que se empieza a avisar. */
const AVISAR_DIAS_ANTES = 5;

/**
 * Lo que el club tiene que saber de su cuenta en la plataforma: si todavía no está
 * aprobado, si está suspendido o si el abono vence. La recepción solo ve lo que le
 * cambia el trabajo (pendiente o suspendido), no lo del pago.
 */
export function EstadoClub() {
  const { club, rol, zona } = useClubActual();
  const sesion = useSesion();
  if (!club) return null;
  const comoPagar = sesion.data?.comoPagarAbono;
  const monto = club.abono?.precio;
  const textoPago = [monto ? `El abono es de ${pesos(monto)} por mes.` : null, comoPagar]
    .filter(Boolean)
    .join(' ');
  // El dueño lo puede dejar pagándose solo desde Mi cuenta.
  const pago = (
    <>
      {textoPago}
      {alcanza(rol, 'OWNER') ? (
        <>
          {' '}
          <Link href={`/panel/${club.id}/cuenta`} className="font-semibold underline">
            Pagalo automático con Mercado Pago
          </Link>
          .
        </>
      ) : null}
    </>
  );

  if (club.estado === 'PENDIENTE') {
    return (
      <Aviso tipo="info">
        <strong>Tu club está en revisión.</strong> Mientras tanto cargá canchas, horarios y precios en
        Configuración. Tu página de reservas ya se puede ver, pero va a tomar reservas cuando lo habilitemos.
      </Aviso>
    );
  }
  if (club.estado === 'SUSPENDIDO') {
    return (
      <Aviso>
        <strong>Las reservas online están pausadas.</strong>
        {club.motivoSuspension ? ` Motivo: ${club.motivoSuspension}.` : ''}{' '}
        {alcanza(rol, 'ADMIN') && (textoPago || alcanza(rol, 'OWNER'))
          ? pago
          : 'Escribinos para reactivarlas.'}
      </Aviso>
    );
  }
  if (!club.abonoHasta || !alcanza(rol, 'ADMIN')) return null;
  const hoy = hoyEn(zona);
  if (club.abonoHasta < hoy) {
    return (
      <Aviso tipo="ambar">
        <strong>Tu abono venció el {fechaLarga(club.abonoHasta).toLowerCase()}.</strong> Pagalo para que tu
        página siga tomando reservas. {pago}
      </Aviso>
    );
  }
  if (club.abonoHasta <= sumarDias(hoy, AVISAR_DIAS_ANTES)) {
    return (
      <Aviso tipo="ambar">
        Tu abono vence el {fechaLarga(club.abonoHasta).toLowerCase()}. {pago}
      </Aviso>
    );
  }
  return null;
}
