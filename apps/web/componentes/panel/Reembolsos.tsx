'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mensajeDe, panel } from '@/lib/api';
import { fechaCorta, fechaLocal, pesos, telefonoLegible } from '@/lib/formato';
import type { Reembolso } from '@/lib/tipos';
import { Aviso, Boton, Cargando } from '../ui';
import { alcanza, useClubActual } from './sesion';

const MOTIVOS: Record<string, string> = {
  PAGO_TARDIO: 'Pagó tarde y el horario ya estaba tomado',
  PAGO_DUPLICADO: 'Pagó la seña dos veces',
  MONTO_INSUFICIENTE: 'El monto no alcanzaba la seña',
  TURNO_CANCELADO: 'Turno cancelado',
};
const MEDIOS: Record<string, string> = {
  MERCADO_PAGO: 'Mercado Pago',
  TRANSFERENCIA: 'Transferencia',
  EFECTIVO: 'Efectivo',
  OTRO: 'Otro',
};

export function Reembolsos() {
  const { clubId, rol, zona } = useClubActual();
  const qc = useQueryClient();
  const lista = useQuery({
    queryKey: ['reembolsos', clubId],
    queryFn: () => panel.get<Reembolso[]>(`/clubs/${clubId}/reembolsos`),
  });
  const hecho = useMutation({
    mutationFn: (id: string) => panel.post(`/clubs/${clubId}/reembolsos/${id}/hecho`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reembolsos', clubId] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-[30px] font-bold">Reembolsos</h1>
        <p className="text-sm text-suave">
          Los de Mercado Pago se devuelven solos. Los de transferencia o efectivo los devuelve el club y los
          marca acá.
        </p>
      </div>
      {hecho.error ? <Aviso>{mensajeDe(hecho.error)}</Aviso> : null}
      {lista.isPending ? (
        <Cargando />
      ) : lista.isError ? (
        <Aviso>{lista.error.message}</Aviso>
      ) : lista.data.length === 0 ? (
        <p className="text-suave">No hay reembolsos.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-linea bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-linea text-xs uppercase tracking-wide text-suave">
              <tr>
                <th className="px-4 py-3 font-semibold">Cliente</th>
                <th className="px-4 py-3 font-semibold">Motivo</th>
                <th className="px-4 py-3 font-semibold">Medio</th>
                <th className="px-4 py-3 text-right font-semibold">Monto</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {lista.data.map((r) => (
                <tr key={r.id} className="border-b border-linea last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{r.cliente?.nombre ?? '—'}</div>
                    <div className="text-xs text-suave">
                      {r.cliente ? telefonoLegible(r.cliente.telefono) : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3">{MOTIVOS[r.motivo] ?? r.motivo}</td>
                  <td className="px-4 py-3">{MEDIOS[r.medio] ?? r.medio}</td>
                  <td className="px-4 py-3 text-right font-semibold">{pesos(r.monto)}</td>
                  <td className="px-4 py-3">
                    {r.estado === 'HECHO'
                      ? `Devuelto ${r.hechoEn ? fechaCorta(fechaLocal(r.hechoEn, zona)) : ''}`
                      : r.estado === 'FALLIDO'
                        ? 'Falló en MP: devolver a mano'
                        : r.manual
                          ? 'Devolver a mano'
                          : 'Lo devuelve Mercado Pago'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.manual && r.estado !== 'HECHO' && alcanza(rol, 'ADMIN') ? (
                      <Boton
                        variante="secundario"
                        disabled={hecho.isPending}
                        onClick={() => hecho.mutate(r.id)}
                      >
                        Marcar devuelto
                      </Boton>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
