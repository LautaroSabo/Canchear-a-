'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { hora, hoyEn, pesos } from '@/lib/formato';
import type { Agenda, MedioCantina, Producto, VentaCantina } from '@/lib/tipos';
import { uuid } from '@/lib/uuid';
import { Aviso, Boton, Cargando, Selector } from '../../ui';
import { useClubActual } from '../sesion';
import { CATEGORIAS, MEDIOS } from './comunes';

export function useProductos() {
  const { clubId } = useClubActual();
  return useQuery({
    queryKey: ['cantina', clubId, 'productos'],
    queryFn: () => panel.get<Producto[]>(`/clubs/${clubId}/cantina/productos`),
  });
}

/**
 * Mostrador: grilla de productos + carrito. Sin `turnoId` deja elegir entre cobrar en
 * el momento o cargar a un turno de hoy; con `turnoId` carga directo a ese turno.
 */
export function Vendedor({
  turnoId,
  alVender,
}: {
  turnoId?: string;
  alVender: (v: VentaCantina, destino: string) => void;
}) {
  const { clubId, zona } = useClubActual();
  const qc = useQueryClient();
  const productos = useProductos();
  const [carrito, setCarrito] = useState<Map<string, number>>(new Map());
  const [destino, setDestino] = useState<'ahora' | 'turno'>(turnoId ? 'turno' : 'ahora');
  const [medio, setMedio] = useState<MedioCantina>('EFECTIVO');
  const [turnoElegido, setTurnoElegido] = useState('');
  const [clave, setClave] = useState(uuid);
  const hoy = hoyEn(zona);
  const agenda = useQuery({
    queryKey: ['agenda', clubId, hoy],
    queryFn: () => panel.get<Agenda>(`/clubs/${clubId}/agenda?fecha=${hoy}`),
    enabled: !turnoId && destino === 'turno',
  });
  const turnosConCuenta = (agenda.data?.turnos ?? []).filter(
    (t) => t.cliente && (t.estado === 'CONFIRMADO' || t.estado === 'PRESENTE'),
  );
  const nombreCancha = (id: string) => agenda.data?.canchas.find((c) => c.id === id)?.nombre ?? '';

  const porId = useMemo(() => new Map((productos.data ?? []).map((p) => [p.id, p])), [productos.data]);
  const renglones = [...carrito].flatMap(([id, cantidad]) => {
    const p = porId.get(id);
    return p ? [{ p, cantidad }] : [];
  });
  const total = renglones.reduce((a, r) => a + r.p.precio * r.cantidad, 0);
  const cambiar = (id: string, delta: number) => {
    const p = porId.get(id);
    const n = Math.max(0, (carrito.get(id) ?? 0) + delta);
    if (p?.controlaStock && n > p.stock) return;
    const nuevo = new Map(carrito);
    if (n === 0) nuevo.delete(id);
    else nuevo.set(id, n);
    setCarrito(nuevo);
  };

  const destinoTurno = turnoId ?? (destino === 'turno' ? turnoElegido : undefined);
  const vender = useMutation({
    mutationFn: () =>
      panel.post<VentaCantina>(`/clubs/${clubId}/cantina/ventas`, {
        items: renglones.map((r) => ({ productoId: r.p.id, cantidad: r.cantidad })),
        ...(destinoTurno ? { turnoId: destinoTurno } : { medio }),
        idempotencyKey: clave,
      }),
    onSuccess: (v) => {
      const t = turnosConCuenta.find((x) => x.id === destinoTurno);
      const texto = destinoTurno
        ? `Cargado a la cuenta${t?.cliente ? ` de ${t.cliente.nombre}` : ' del turno'}`
        : `Cobrado en ${MEDIOS[medio].toLowerCase()}`;
      setCarrito(new Map());
      setClave(uuid());
      qc.invalidateQueries({ queryKey: ['cantina', clubId] });
      qc.invalidateQueries({ queryKey: ['agenda', clubId] });
      if (destinoTurno) qc.invalidateQueries({ queryKey: ['turno', clubId, destinoTurno] });
      alVender(v, texto);
    },
    onError: () => qc.invalidateQueries({ queryKey: ['cantina', clubId, 'productos'] }),
  });

  if (productos.isPending) return <Cargando />;
  if (productos.isError) return <Aviso>{productos.error.message}</Aviso>;
  const categorias = Object.keys(CATEGORIAS).filter((c) => productos.data.some((p) => p.categoria === c));

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {categorias.map((c) => (
          <section key={c} aria-label={CATEGORIAS[c as keyof typeof CATEGORIAS]}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-suave">
              {CATEGORIAS[c as keyof typeof CATEGORIAS]}
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {productos.data
                .filter((p) => p.categoria === c)
                .map((p) => {
                  const agotado = p.controlaStock && p.stock - (carrito.get(p.id) ?? 0) <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={agotado}
                      onClick={() => cambiar(p.id, 1)}
                      aria-label={`Agregar ${p.nombre}, ${pesos(p.precio)}`}
                      className="flex min-h-16 flex-col items-start justify-center rounded-xl border border-linea bg-white px-3 py-2 text-left hover:border-cancha disabled:opacity-50"
                    >
                      <span className="text-sm font-bold">{p.nombre}</span>
                      <span className="text-[13px] text-medio">
                        {pesos(p.precio)}
                        {p.controlaStock ? ` · ${agotado ? 'sin stock' : `quedan ${p.stock}`}` : ''}
                      </span>
                    </button>
                  );
                })}
            </div>
          </section>
        ))}
      </div>

      <section
        aria-label="Pedido"
        className="flex flex-col gap-3 rounded-2xl border border-linea bg-white p-4 lg:w-80 lg:flex-none"
      >
        <h3 className="font-bold">Pedido</h3>
        {renglones.length === 0 ? (
          <p className="text-sm text-suave">Tocá los productos para agregarlos.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {renglones.map(({ p, cantidad }) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Sacar un ${p.nombre}`}
                    onClick={() => cambiar(p.id, -1)}
                    className="size-8 rounded-lg border border-linea"
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-bold">{cantidad}</span>
                  <button
                    type="button"
                    aria-label={`Sumar un ${p.nombre}`}
                    onClick={() => cambiar(p.id, 1)}
                    className="size-8 rounded-lg border border-linea"
                  >
                    +
                  </button>
                </span>
                <span className="w-20 text-right">{pesos(p.precio * cantidad)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-baseline justify-between border-t border-linea pt-2">
          <span className="font-bold">Total</span>
          <span className="font-display text-2xl font-bold">{pesos(total)}</span>
        </div>

        {turnoId ? null : (
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">¿Cómo se paga?</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={destino === 'ahora'}
                onChange={() => setDestino('ahora')}
                className="accent-cancha"
              />
              Cobrar ahora
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={destino === 'turno'}
                onChange={() => setDestino('turno')}
                className="accent-cancha"
              />
              A la cuenta de un turno de hoy
            </label>
          </fieldset>
        )}
        {!turnoId && destino === 'ahora' ? (
          <Selector
            etiqueta="Medio de pago"
            value={medio}
            onChange={(e) => setMedio(e.target.value as MedioCantina)}
          >
            {Object.entries(MEDIOS).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </Selector>
        ) : null}
        {!turnoId && destino === 'turno' ? (
          agenda.isPending ? (
            <Cargando />
          ) : (
            <Selector etiqueta="Turno" value={turnoElegido} onChange={(e) => setTurnoElegido(e.target.value)}>
              <option value="">{turnosConCuenta.length ? 'Elegí el turno' : 'No hay turnos de hoy'}</option>
              {turnosConCuenta.map((t) => (
                <option key={t.id} value={t.id}>
                  {hora(t.inicio, zona)} · {nombreCancha(t.canchaId)} · {t.cliente?.nombre}
                </option>
              ))}
            </Selector>
          )
        ) : null}
        {vender.error ? <Aviso>{mensajeDe(vender.error)}</Aviso> : null}
        <Boton
          grande
          disabled={vender.isPending || renglones.length === 0 || (destino === 'turno' && !destinoTurno)}
          onClick={() => vender.mutate()}
        >
          {destinoTurno ? `Cargar ${pesos(total)} al turno` : `Cobrar ${pesos(total)}`}
        </Boton>
      </section>
    </div>
  );
}
