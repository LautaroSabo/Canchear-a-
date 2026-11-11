'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { fechaLarga, pesos } from '@/lib/formato';
import type { EstadoAbono } from '@/lib/tipos';
import { Aviso, Boton, Campo, Insignia, Tarjeta } from '../ui';
import { alcanza, useClubActual } from './sesion';

/** El abono del club a la plataforma, con el pago automático por Mercado Pago. Solo el dueño. */
export function AbonoAutomatico() {
  const { clubId, rol } = useClubActual();
  const volvio = useSearchParams().get('abono') === 'listo';
  const qc = useQueryClient();
  const esDueno = alcanza(rol, 'OWNER');
  const datos = useQuery({
    queryKey: ['abono', clubId],
    queryFn: () => panel.get<EstadoAbono>(`/clubs/${clubId}/abono`),
    enabled: esDueno,
    // Al volver de Mercado Pago la confirmación llega en unos segundos.
    refetchInterval: (q) => (q.state.data?.suscripcion?.estado === 'pending' ? 10_000 : false),
  });
  const [email, setEmail] = useState<string | null>(null);
  const iniciar = useMutation({
    mutationFn: (e: string) =>
      panel.post<{ urlCheckout: string }>(`/clubs/${clubId}/abono/suscripcion`, { email: e }),
    onSuccess: (r) => window.location.assign(r.urlCheckout),
  });
  const cancelar = useMutation({
    mutationFn: () => panel.borrar(`/clubs/${clubId}/abono/suscripcion`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['abono', clubId] }),
  });

  if (!esDueno || !datos.data) return null;
  const d = datos.data;
  const s = d.suscripcion;
  const activa = s?.estado === 'authorized';
  const mail = email ?? s?.email ?? d.emailDueno ?? '';

  function enviar(e: FormEvent) {
    e.preventDefault();
    iniciar.mutate(mail);
  }

  return (
    <Tarjeta className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Abono de Canchería</h2>
        {activa ? <Insignia tono="ok">Se paga solo</Insignia> : null}
      </div>
      {d.precio.plan ? (
        <div className="flex flex-col gap-1 text-sm">
          <p>
            Plan <strong>{d.precio.plan.nombre}</strong> · {d.precio.canchas}{' '}
            {d.precio.canchas === 1 ? 'cancha activa' : 'canchas activas'} ·{' '}
            <strong className="cifras">{pesos(d.precio.precio ?? 0)} por mes</strong>
            {d.precio.especial ? (
              <span className="text-tenue">
                {' '}
                (en vez de <span className="line-through">{pesos(d.precio.precioLista ?? 0)}</span>
                {d.precio.especial.motivo ? `, ${d.precio.especial.motivo.toLowerCase()}` : ''}
                {d.precio.especial.hasta
                  ? ` hasta el ${fechaLarga(d.precio.especial.hasta).toLowerCase()}`
                  : ''}
                )
              </span>
            ) : null}
          </p>
          <p className="text-tenue">
            El precio depende de cuántas canchas activas tenés. Si sumás canchas y pasás de plan, el nuevo
            precio corre desde el mes siguiente.
          </p>
        </div>
      ) : null}
      {d.abonoHasta ? (
        <p className="text-sm">Pagado hasta el {fechaLarga(d.abonoHasta).toLowerCase()}.</p>
      ) : null}
      {volvio && !activa ? (
        <Aviso tipo="info">
          Listo. En cuanto Mercado Pago confirme la autorización, acá va a decir "Se paga solo".
        </Aviso>
      ) : null}
      {activa ? (
        <>
          <p className="text-sm text-tenue">
            Mercado Pago lo debita todos los meses{s?.email ? ` de la cuenta ${s.email}` : ''}. Con cada pago,
            el abono se extiende un mes.
          </p>
          <div>
            <Boton
              variante="peligro"
              disabled={cancelar.isPending}
              onClick={() => {
                if (
                  window.confirm('¿Dejar de pagar el abono automáticamente? Vas a tener que pagarlo a mano.')
                )
                  cancelar.mutate();
              }}
            >
              Dejar de pagar automáticamente
            </Boton>
          </div>
        </>
      ) : d.cobroAutomatico ? (
        <form onSubmit={enviar} className="flex flex-col gap-3">
          <p className="text-sm text-tenue">
            Pagalo automáticamente con Mercado Pago (tarjeta o dinero en cuenta) y olvidate del vencimiento:
            se debita una vez por mes
            {d.abonoHasta ? ', a partir de que terminen los días que ya tenés pagos' : ''}. Lo cancelás cuando
            quieras.
          </p>
          <Campo
            etiqueta="Email de tu cuenta de Mercado Pago"
            type="email"
            required
            value={mail}
            onChange={(e) => setEmail(e.target.value)}
            ayuda="Tiene que ser el mismo con el que entrás a Mercado Pago."
          />
          {iniciar.error ? <Aviso>{mensajeDe(iniciar.error)}</Aviso> : null}
          {cancelar.error ? <Aviso>{mensajeDe(cancelar.error)}</Aviso> : null}
          <div>
            <Boton type="submit" variante="mp" disabled={iniciar.isPending || !mail}>
              {iniciar.isPending ? 'Abriendo Mercado Pago…' : 'Pagar automáticamente con Mercado Pago'}
            </Boton>
          </div>
        </form>
      ) : null}
    </Tarjeta>
  );
}
