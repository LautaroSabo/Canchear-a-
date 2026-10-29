'use client';

import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import type { CanchaConfig, Superficie } from '@/lib/tipos';
import { Aviso, Boton, Campo, Casilla, Selector, Tarjeta } from '../../ui';
import { Dialogo } from '../Dialogo';
import { SUPERFICIES, useGuardar } from './comunes';

type Datos = Omit<CanchaConfig, 'id'>;

export function Canchas({ canchas }: { canchas: CanchaConfig[] }) {
  const [editando, setEditando] = useState<CanchaConfig | 'nueva' | null>(null);
  const activar = useGuardar((clubId, c: CanchaConfig) =>
    panel.patch(`/clubs/${clubId}/config/canchas/${c.id}`, { activa: !c.activa }),
  );

  return (
    <Tarjeta className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Canchas</h2>
        <Boton variante="secundario" onClick={() => setEditando('nueva')}>
          Agregar cancha
        </Boton>
      </div>
      <p className="text-sm text-suave">
        Una cancha desactivada deja de aparecer en la página de reservas; sus turnos ya tomados se mantienen.
      </p>
      {activar.error ? <Aviso>{mensajeDe(activar.error)}</Aviso> : null}
      <ul className="flex flex-col divide-y divide-linea">
        {canchas.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className={c.activa ? '' : 'text-suave'}>
              <div className="font-bold">
                {c.nombre}
                {c.activa ? null : (
                  <span className="ml-2 rounded-full bg-fondo px-2 py-0.5 text-xs font-semibold">
                    Inactiva
                  </span>
                )}
              </div>
              <div className="text-sm text-medio">
                Fútbol {c.jugadoresPorLado} · {SUPERFICIES[c.superficie]} · turnos de {c.duracionTurnoMin} min
                {c.techada ? ' · techada' : ''}
                {c.iluminacion ? '' : ' · sin luz'}
              </div>
            </div>
            <div className="flex gap-2">
              <Boton variante="fantasma" onClick={() => setEditando(c)}>
                Editar
              </Boton>
              <Boton
                variante="fantasma"
                className={c.activa ? 'text-peligro hover:bg-error-fondo' : ''}
                disabled={activar.isPending}
                onClick={() => {
                  if (
                    !c.activa ||
                    window.confirm(`¿Desactivar ${c.nombre}? Deja de aparecer en la página de reservas.`)
                  )
                    activar.mutate(c);
                }}
              >
                {c.activa ? 'Desactivar' : 'Activar'}
              </Boton>
            </div>
          </li>
        ))}
      </ul>
      <Dialogo
        abierto={editando !== null}
        alCerrar={() => setEditando(null)}
        titulo={editando === 'nueva' ? 'Nueva cancha' : `Editar ${editando?.nombre ?? ''}`}
      >
        {editando ? (
          <FormCancha
            cancha={editando === 'nueva' ? null : editando}
            siguienteOrden={Math.max(0, ...canchas.map((c) => c.orden)) + 1}
            alGuardar={() => setEditando(null)}
          />
        ) : null}
      </Dialogo>
    </Tarjeta>
  );
}

function FormCancha({
  cancha,
  siguienteOrden,
  alGuardar,
}: {
  cancha: CanchaConfig | null;
  siguienteOrden: number;
  alGuardar: () => void;
}) {
  const [f, setF] = useState<Datos>(
    cancha ?? {
      nombre: '',
      jugadoresPorLado: 5,
      superficie: 'SINTETICO',
      techada: false,
      iluminacion: true,
      duracionTurnoMin: 60,
      orden: siguienteOrden,
      activa: true,
    },
  );
  const guardar = useGuardar(
    (clubId) =>
      cancha
        ? panel.patch(`/clubs/${clubId}/config/canchas/${cancha.id}`, f)
        : panel.post(`/clubs/${clubId}/config/canchas`, f),
    alGuardar,
  );

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        guardar.mutate();
      }}
    >
      <div className="sm:col-span-2">
        <Campo
          etiqueta="Nombre"
          value={f.nombre}
          onChange={(e) => setF({ ...f, nombre: e.target.value })}
          required
          maxLength={60}
          placeholder="Cancha 4"
        />
      </div>
      <Selector
        etiqueta="Jugadores por lado"
        value={f.jugadoresPorLado}
        onChange={(e) => setF({ ...f, jugadoresPorLado: Number(e.target.value) })}
      >
        {[5, 6, 7, 8, 9, 11].map((n) => (
          <option key={n} value={n}>
            Fútbol {n}
          </option>
        ))}
      </Selector>
      <Selector
        etiqueta="Duración del turno"
        value={f.duracionTurnoMin}
        onChange={(e) =>
          setF({ ...f, duracionTurnoMin: Number(e.target.value) as Datos['duracionTurnoMin'] })
        }
        ayuda={cancha ? 'Los turnos ya tomados mantienen su duración.' : undefined}
      >
        {[30, 60, 90, 120].map((n) => (
          <option key={n} value={n}>
            {n} minutos
          </option>
        ))}
      </Selector>
      <Selector
        etiqueta="Superficie"
        value={f.superficie}
        onChange={(e) => setF({ ...f, superficie: e.target.value as Superficie })}
      >
        {Object.entries(SUPERFICIES).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </Selector>
      <Campo
        etiqueta="Orden en la grilla"
        type="number"
        min={0}
        max={1000}
        value={f.orden}
        onChange={(e) => setF({ ...f, orden: Number(e.target.value) })}
      />
      <Casilla
        etiqueta="Techada"
        checked={f.techada}
        onChange={(e) => setF({ ...f, techada: e.target.checked })}
      />
      <Casilla
        etiqueta="Con iluminación"
        checked={f.iluminacion}
        onChange={(e) => setF({ ...f, iluminacion: e.target.checked })}
      />
      {guardar.error ? (
        <div className="sm:col-span-2">
          <Aviso>{mensajeDe(guardar.error)}</Aviso>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Boton type="submit" disabled={guardar.isPending} className="w-full">
          {cancha ? 'Guardar cambios' : 'Agregar cancha'}
        </Boton>
      </div>
    </form>
  );
}
