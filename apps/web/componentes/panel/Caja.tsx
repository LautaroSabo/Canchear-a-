'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { fechaCorta, fechaLocal, hora, pesos } from '@/lib/formato';
import type { CajaActual, CierreCaja, MedioCaja } from '@/lib/tipos';
import {
  Aviso,
  Boton,
  Campo,
  Cargando,
  EncabezadoPagina,
  EstadoVacio,
  Insignia,
  Numero,
  Tarjeta,
} from '../ui';
import { aCentavos, pesosValidos } from './config/comunes';
import { alcanza, useClubActual } from './sesion';

const MEDIOS: Record<MedioCaja, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
  OTRO: 'Otro (posnet, QR)',
};

/** "Sobran $500", "Faltan $1.200", "Justo". */
function textoDiferencia(d: number) {
  if (d === 0) return { texto: 'Justo', tono: 'ok' as const };
  return d > 0
    ? { texto: `Sobran ${pesos(d)}`, tono: 'aviso' as const }
    : { texto: `Faltan ${pesos(-d)}`, tono: 'error' as const };
}

export function Caja() {
  const { clubId, rol, zona } = useClubActual();
  const qc = useQueryClient();
  const esAdmin = alcanza(rol, 'ADMIN');
  const actual = useQuery({
    queryKey: ['caja', clubId],
    queryFn: () => panel.get<CajaActual>(`/clubs/${clubId}/caja`),
    refetchInterval: 30_000,
  });
  const historial = useQuery({
    queryKey: ['caja', clubId, 'cierres'],
    queryFn: () => panel.get<CierreCaja[]>(`/clubs/${clubId}/caja/cierres`),
    enabled: esAdmin,
  });
  const [contado, setContado] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cerrado, setCerrado] = useState<CierreCaja | null>(null);
  const cerrar = useMutation({
    mutationFn: () =>
      panel.post<CierreCaja>(`/clubs/${clubId}/caja/cierres`, {
        efectivoContado: aCentavos(contado),
        ...(nota.trim() ? { nota: nota.trim() } : {}),
      }),
    onSuccess: (c) => {
      setCerrado(c);
      setContado('');
      setNota('');
      qc.invalidateQueries({ queryKey: ['caja', clubId] });
    },
  });
  const cuando = (iso: string) => `${fechaCorta(fechaLocal(iso, zona))} ${hora(iso, zona)}`;

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!pesosValidos(contado))
      return setError('Escribí cuánta plata en efectivo hay en la caja, por ejemplo 45000.');
    setError(null);
    cerrar.mutate();
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <EncabezadoPagina
        titulo="Caja"
        bajada="Lo que entró desde el último cierre, por medio de pago. Al cerrar, contá el efectivo y anotalo: queda guardado quién cerró y si faltó o sobró plata."
      />
      {cerrado ? (
        <Aviso tipo={cerrado.diferencia === 0 ? 'ok' : 'ambar'}>
          Caja cerrada. Esperado {pesos(cerrado.efectivoEsperado)}, contado {pesos(cerrado.efectivoContado)}:{' '}
          <strong>{textoDiferencia(cerrado.diferencia).texto}</strong>.
        </Aviso>
      ) : null}
      {actual.isPending ? (
        <Cargando />
      ) : actual.isError ? (
        <Aviso>{actual.error.message}</Aviso>
      ) : (
        <>
          <p className="text-sm text-tenue">
            Desde {actual.data.ultimoCierre ? `el cierre de ${actual.data.ultimoCierre.usuario}, ` : ''}
            {cuando(actual.data.desde)} hasta ahora · {actual.data.movimientos}{' '}
            {actual.data.movimientos === 1 ? 'movimiento' : 'movimientos'}
          </p>
          <div className="overflow-x-auto border border-linea bg-superficie">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-linea bg-superficie-2 text-left text-tenue">
                  <th className="px-3 py-2 font-semibold">Medio</th>
                  <th className="px-3 py-2 text-right font-semibold">Señas</th>
                  <th className="px-3 py-2 text-right font-semibold">Saldos</th>
                  <th className="px-3 py-2 text-right font-semibold">Cantina</th>
                  <th className="px-3 py-2 text-right font-semibold">Devoluciones</th>
                  <th className="px-3 py-2 text-right font-bold text-tinta">Total</th>
                </tr>
              </thead>
              <tbody className="cifras">
                {actual.data.porMedio.map((f) => (
                  <tr key={f.medio} className="border-b border-linea">
                    <th scope="row" className="px-3 py-2 text-left font-semibold">
                      {MEDIOS[f.medio]}
                    </th>
                    <td className="px-3 py-2 text-right">{pesos(f.senas)}</td>
                    <td className="px-3 py-2 text-right">{pesos(f.saldos)}</td>
                    <td className="px-3 py-2 text-right">{pesos(f.cantina)}</td>
                    <td className="px-3 py-2 text-right">
                      {f.devoluciones ? `−${pesos(f.devoluciones)}` : pesos(0)}
                    </td>
                    <td className="px-3 py-2 text-right font-bold">{pesos(f.total)}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="px-3 py-2 text-left font-bold">
                    Total
                  </th>
                  <td colSpan={4} />
                  <td className="px-3 py-2 text-right font-bold">{pesos(actual.data.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <Tarjeta className="flex flex-col gap-4">
            <div>
              <p className="text-sm text-tenue">Efectivo que tendría que haber en la caja</p>
              <Numero className="text-[40px]">{pesos(actual.data.efectivoEsperado)}</Numero>
            </div>
            <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
              <Campo
                etiqueta="Efectivo contado"
                inputMode="decimal"
                placeholder="45000"
                value={contado}
                onChange={(e) => setContado(e.target.value)}
                error={error ?? undefined}
              />
              <Campo
                etiqueta="Nota (opcional)"
                maxLength={300}
                placeholder="Saqué $5.000 para hielo"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
              />
              <Boton type="submit" disabled={cerrar.isPending || !contado}>
                Cerrar caja
              </Boton>
            </form>
            {contado && pesosValidos(contado) ? (
              <p className="text-sm">
                Diferencia:{' '}
                <Insignia tono={textoDiferencia(aCentavos(contado) - actual.data.efectivoEsperado).tono}>
                  {textoDiferencia(aCentavos(contado) - actual.data.efectivoEsperado).texto}
                </Insignia>
              </p>
            ) : null}
            {cerrar.error ? <Aviso>{mensajeDe(cerrar.error)}</Aviso> : null}
          </Tarjeta>
        </>
      )}

      {esAdmin ? (
        <section aria-labelledby="titulo-cierres" className="flex flex-col gap-3">
          <h2 id="titulo-cierres" className="font-display text-2xl font-bold uppercase">
            Cierres anteriores
          </h2>
          {historial.isPending ? (
            <Cargando />
          ) : historial.isError ? (
            <Aviso>{historial.error.message}</Aviso>
          ) : historial.data.length === 0 ? (
            <EstadoVacio titulo="Todavía no se cerró la caja." />
          ) : (
            <ul className="border border-linea bg-superficie">
              {historial.data.map((c) => {
                const d = textoDiferencia(c.diferencia);
                return (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-linea px-4 py-3 last:border-b-0"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">
                        {cuando(c.hasta)} · {c.usuario}
                      </span>
                      <span className="cifras text-sm text-tenue">
                        Esperado {pesos(c.efectivoEsperado)} · contado {pesos(c.efectivoContado)}
                        {c.nota ? ` · ${c.nota}` : ''}
                      </span>
                    </span>
                    <Insignia tono={d.tono}>{d.texto}</Insignia>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
