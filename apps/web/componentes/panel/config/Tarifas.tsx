'use client';

import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { fechaCorta, pesos } from '@/lib/formato';
import type { CanchaConfig, TarifaConfig } from '@/lib/tipos';
import { Aviso, Boton, Campo, Selector, Tarjeta } from '../../ui';
import { Dialogo } from '../Dialogo';
import { aCentavos, aTextoPesos, DIAS, franjaTexto, ORDEN_SEMANA, pesosValidos, useGuardar } from './comunes';

export function Tarifas({
  tarifas,
  canchas,
  hoy,
}: {
  tarifas: TarifaConfig[];
  canchas: CanchaConfig[];
  hoy: string;
}) {
  const [editando, setEditando] = useState<TarifaConfig | 'nueva' | null>(null);
  const borrar = useGuardar((clubId, id: string) => panel.borrar(`/clubs/${clubId}/config/tarifas/${id}`));
  const grupos = [
    { id: null, nombre: 'Todas las canchas' },
    ...canchas.map((c) => ({ id: c.id, nombre: c.nombre })),
  ]
    .map((g) => ({ ...g, tarifas: tarifas.filter((t) => t.canchaId === g.id) }))
    .filter((g) => g.tarifas.length > 0);

  return (
    <Tarjeta className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Tarifas</h2>
        <Boton variante="secundario" onClick={() => setEditando('nueva')}>
          Agregar tarifa
        </Boton>
      </div>
      <p className="text-sm text-suave">
        Precio por turno según la hora de inicio. Si dos tarifas aplican, gana la más específica: una de una
        cancha le gana a la general, y una de un día le gana a la de todos los días. Para programar un
        aumento, cargá la nueva con “vigente desde”.
      </p>
      {borrar.error ? <Aviso>{mensajeDe(borrar.error)}</Aviso> : null}
      {grupos.map((g) => (
        <section key={g.id ?? 'general'} aria-label={g.nombre}>
          <h3 className="mb-1 mt-2 text-xs font-semibold text-suave">{g.nombre}</h3>
          <ul className="flex flex-col divide-y divide-linea">
            {g.tarifas.map((t) => {
              const vencida = t.vigenteHasta !== null && t.vigenteHasta < hoy;
              return (
                <li
                  key={t.id}
                  className={`flex flex-wrap items-center justify-between gap-2 py-2.5 ${vencida ? 'text-suave' : ''}`}
                >
                  <div>
                    <div className="font-bold">
                      {t.diaSemana === null ? 'Todos los días' : DIAS[t.diaSemana]} ·{' '}
                      {franjaTexto(t.horaDesde, t.horaHasta)} · {pesos(t.precio)}
                    </div>
                    <div className="text-sm text-medio">
                      {t.etiqueta ? `${t.etiqueta} · ` : ''}
                      {vigencia(t, hoy)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Boton variante="fantasma" onClick={() => setEditando(t)}>
                      Editar
                    </Boton>
                    <Boton
                      variante="fantasma"
                      disabled={borrar.isPending}
                      onClick={() => borrar.mutate(t.id)}
                    >
                      Borrar
                    </Boton>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <Dialogo
        abierto={editando !== null}
        alCerrar={() => setEditando(null)}
        titulo={editando === 'nueva' ? 'Nueva tarifa' : 'Editar tarifa'}
      >
        {editando ? (
          <FormTarifa
            tarifa={editando === 'nueva' ? null : editando}
            canchas={canchas}
            hoy={hoy}
            alGuardar={() => setEditando(null)}
          />
        ) : null}
      </Dialogo>
    </Tarjeta>
  );
}

function vigencia(t: TarifaConfig, hoy: string) {
  if (t.vigenteHasta !== null && t.vigenteHasta < hoy) return `Terminó el ${fechaCorta(t.vigenteHasta)}`;
  if (t.vigenteDesde > hoy) return `Desde el ${fechaCorta(t.vigenteDesde)}`;
  if (t.vigenteHasta !== null) return `Hasta el ${fechaCorta(t.vigenteHasta)}`;
  return 'Vigente';
}

function FormTarifa({
  tarifa,
  canchas,
  hoy,
  alGuardar,
}: {
  tarifa: TarifaConfig | null;
  canchas: CanchaConfig[];
  hoy: string;
  alGuardar: () => void;
}) {
  const [f, setF] = useState({
    canchaId: tarifa?.canchaId ?? '',
    diaSemana: tarifa?.diaSemana === null || !tarifa ? '' : String(tarifa.diaSemana),
    horaDesde: tarifa?.horaDesde ?? '18:00',
    horaHasta: tarifa?.horaHasta ?? '00:00',
    precio: tarifa ? aTextoPesos(tarifa.precio) : '',
    etiqueta: tarifa?.etiqueta ?? '',
    vigenteDesde: tarifa?.vigenteDesde ?? hoy,
    vigenteHasta: tarifa?.vigenteHasta ?? '',
  });
  const precioOk = pesosValidos(f.precio);
  const guardar = useGuardar((clubId) => {
    const cuerpo = {
      canchaId: f.canchaId || null,
      diaSemana: f.diaSemana === '' ? null : Number(f.diaSemana),
      horaDesde: f.horaDesde,
      horaHasta: f.horaHasta,
      precio: aCentavos(f.precio),
      etiqueta: f.etiqueta.trim() || null,
      vigenteDesde: f.vigenteDesde,
      vigenteHasta: f.vigenteHasta || null,
    };
    return tarifa
      ? panel.put(`/clubs/${clubId}/config/tarifas/${tarifa.id}`, cuerpo)
      : panel.post(`/clubs/${clubId}/config/tarifas`, cuerpo);
  }, alGuardar);

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (precioOk) guardar.mutate();
      }}
    >
      <Selector
        etiqueta="Cancha"
        value={f.canchaId}
        onChange={(e) => setF({ ...f, canchaId: e.target.value })}
      >
        <option value="">Todas las canchas</option>
        {canchas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </Selector>
      <Selector
        etiqueta="Día"
        value={f.diaSemana}
        onChange={(e) => setF({ ...f, diaSemana: e.target.value })}
      >
        <option value="">Todos los días</option>
        {ORDEN_SEMANA.map((d) => (
          <option key={d} value={d}>
            {DIAS[d]}
          </option>
        ))}
      </Selector>
      <Campo
        etiqueta="Desde"
        type="time"
        value={f.horaDesde}
        onChange={(e) => setF({ ...f, horaDesde: e.target.value })}
        required
      />
      <Campo
        etiqueta="Hasta"
        type="time"
        value={f.horaHasta}
        onChange={(e) => setF({ ...f, horaHasta: e.target.value })}
        required
        ayuda="00:00 = hasta medianoche. Después de medianoche va en otra tarifa, desde las 00:00."
      />
      <Campo
        etiqueta="Precio del turno ($)"
        inputMode="decimal"
        placeholder="45000"
        value={f.precio}
        onChange={(e) => setF({ ...f, precio: e.target.value })}
        required
        aria-invalid={f.precio !== '' && !precioOk}
      />
      <Campo
        etiqueta="Etiqueta (opcional)"
        placeholder="Pico, Valle…"
        maxLength={40}
        value={f.etiqueta}
        onChange={(e) => setF({ ...f, etiqueta: e.target.value })}
      />
      <Campo
        etiqueta="Vigente desde"
        type="date"
        value={f.vigenteDesde}
        onChange={(e) => setF({ ...f, vigenteDesde: e.target.value })}
        required
      />
      <Campo
        etiqueta="Vigente hasta (opcional)"
        type="date"
        value={f.vigenteHasta}
        onChange={(e) => setF({ ...f, vigenteHasta: e.target.value })}
      />
      {f.precio !== '' && !precioOk ? (
        <div className="sm:col-span-2">
          <Aviso>Escribí el precio en pesos, sin signos (por ejemplo 45000).</Aviso>
        </div>
      ) : null}
      {guardar.error ? (
        <div className="sm:col-span-2">
          <Aviso>{mensajeDe(guardar.error)}</Aviso>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Boton type="submit" disabled={guardar.isPending} className="w-full">
          {tarifa ? 'Guardar cambios' : 'Agregar tarifa'}
        </Boton>
      </div>
    </form>
  );
}
