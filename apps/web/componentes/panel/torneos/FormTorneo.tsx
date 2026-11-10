'use client';

import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { pedir } from '@/lib/api';
import { claveTipo, hoyEn, tipoDeClave } from '@/lib/formato';
import type { ClubPublico, ConfigTorneo } from '@/lib/tipos';
import { Aviso, Boton, Campo, Casilla, Segmentado, Selector } from '../../ui';
import { DIAS, ORDEN_SEMANA } from '../config/comunes';
import { useClubActual } from '../sesion';

type Formato = 'liga' | 'grupos';

export function FormTorneo({
  inicial,
  enviando,
  error,
  alEnviar,
  textoBoton,
}: {
  inicial?: ConfigTorneo;
  enviando: boolean;
  error: string | null;
  alEnviar: (d: ConfigTorneo) => void;
  textoBoton: string;
}) {
  const { club, zona } = useClubActual();
  const publico = useQuery({
    queryKey: ['club-publico', club?.slug],
    queryFn: () => pedir<ClubPublico>(`/public/clubs/${club?.slug}`),
    enabled: Boolean(club?.slug),
  });
  const canchas = publico.data?.canchas ?? [];
  const [formato, setFormato] = useState<Formato>(
    inicial && (inicial.cantidadGrupos > 1 || inicial.clasificanPorGrupo > 0) ? 'grupos' : 'liga',
  );
  const [dias, setDias] = useState<number[]>(inicial?.dias ?? [2, 4]);
  const [canchaIds, setCanchaIds] = useState<string[]>(inicial?.canchaIds ?? []);
  const [falta, setFalta] = useState<string | null>(null);

  const alternar = <T,>(lista: T[], x: T) =>
    lista.includes(x) ? lista.filter((y) => y !== x) : [...lista, x];

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const elegidas = canchaIds.length ? canchaIds : canchas.length === 1 && canchas[0] ? [canchas[0].id] : [];
    if (!dias.length) return setFalta('Elegí al menos un día para los partidos.');
    if (!elegidas.length) return setFalta('Elegí al menos una cancha.');
    setFalta(null);
    const grupos = formato === 'grupos';
    alEnviar({
      nombre: String(f.get('nombre')),
      descripcion: String(f.get('descripcion') ?? '') || null,
      deporte: tipoDeClave(String(f.get('tipo'))).deporte,
      jugadoresPorLado: tipoDeClave(String(f.get('tipo'))).jugadores,
      inscripcionOnline: f.get('online') === 'on',
      cantidadGrupos: grupos ? Number(f.get('grupos')) : 1,
      idaYVuelta: f.get('idaYVuelta') === 'on',
      clasificanPorGrupo: grupos ? Number(f.get('clasifican')) : 0,
      dias,
      horaDesde: String(f.get('desde')),
      horaHasta: String(f.get('hasta')),
      canchaIds: elegidas,
      fechaInicio: String(f.get('inicio')),
      duracionMin: Number(f.get('duracion')),
    });
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <Campo
        etiqueta="Nombre"
        name="nombre"
        required
        maxLength={80}
        defaultValue={inicial?.nombre}
        placeholder="Liga de los martes"
      />
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Descripción (opcional)
        <textarea
          name="descripcion"
          maxLength={500}
          rows={2}
          defaultValue={inicial?.descripcion ?? ''}
          placeholder="Premios, reglamento, valor de la inscripción…"
          className="rounded-xs border border-borde-control bg-superficie px-3 py-2 text-base font-normal"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Selector etiqueta="Deporte" name="tipo" defaultValue={inicial ? claveTipo(inicial) : 'FUTBOL-5'}>
          {[5, 6, 7, 8, 9, 11].map((n) => (
            <option key={n} value={`FUTBOL-${n}`}>
              Fútbol {n}
            </option>
          ))}
          <option value="PADEL">Pádel (parejas)</option>
          <option value="TENIS">Tenis</option>
        </Selector>
        <Campo
          etiqueta="Empieza"
          name="inicio"
          type="date"
          required
          defaultValue={inicial?.fechaInicio ?? hoyEn(zona)}
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1.5 text-sm font-semibold">Formato</legend>
        <Segmentado
          etiqueta="Formato"
          valor={formato}
          onCambio={setFormato}
          opciones={[
            { valor: 'liga', etiqueta: 'Liga (todos contra todos)' },
            { valor: 'grupos', etiqueta: 'Grupos + eliminación' },
          ]}
        />
        {formato === 'grupos' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Selector etiqueta="Grupos" name="grupos" defaultValue={inicial?.cantidadGrupos ?? 2}>
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? '1 grupo' : `${n} grupos`}
                </option>
              ))}
            </Selector>
            <Selector
              etiqueta="Pasan a la eliminación"
              name="clasifican"
              defaultValue={inicial?.clasificanPorGrupo || 2}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? 'El primero de cada grupo' : `Los ${n} primeros de cada grupo`}
                </option>
              ))}
            </Selector>
          </div>
        ) : null}
        <Casilla
          etiqueta="Ida y vuelta (cada cruce se juega dos veces)"
          name="idaYVuelta"
          defaultChecked={inicial?.idaYVuelta}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-semibold">Días de partido</legend>
        <div className="flex flex-wrap gap-x-4">
          {ORDEN_SEMANA.map((d) => (
            <Casilla
              key={d}
              etiqueta={DIAS[d]}
              checked={dias.includes(d)}
              onChange={() => setDias(alternar(dias, d))}
            />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo
          etiqueta="Desde"
          name="desde"
          type="time"
          required
          defaultValue={inicial?.horaDesde ?? '20:00'}
        />
        <Campo
          etiqueta="Hasta"
          name="hasta"
          type="time"
          required
          defaultValue={inicial?.horaHasta ?? '23:00'}
          ayuda="Si es antes que «Desde», termina pasada la medianoche."
        />
        <Selector etiqueta="Cada partido" name="duracion" defaultValue={inicial?.duracionMin ?? 60}>
          {[40, 50, 60, 70, 80, 90, 120].map((n) => (
            <option key={n} value={n}>
              {n} min
            </option>
          ))}
        </Selector>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-semibold">Canchas</legend>
        <div className="flex flex-wrap gap-x-4">
          {canchas.map((c) => (
            <Casilla
              key={c.id}
              etiqueta={`${c.nombre} (F${c.jugadoresPorLado})`}
              checked={canchaIds.includes(c.id) || (canchas.length === 1 && !canchaIds.length)}
              onChange={() => setCanchaIds(alternar(canchaIds, c.id))}
            />
          ))}
        </div>
        <p className="text-sm text-tenue">
          Al empezar el torneo, la app agenda cada partido en un horario libre de estas canchas y lo bloquea
          en la agenda. Después podés mover cualquiera.
        </p>
      </fieldset>
      <Casilla
        etiqueta="Inscripción online (los equipos se anotan desde la página del torneo y vos los aprobás)"
        name="online"
        defaultChecked={inicial?.inscripcionOnline ?? true}
      />
      {falta ? <Aviso>{falta}</Aviso> : null}
      {error ? <Aviso>{error}</Aviso> : null}
      <Boton type="submit" disabled={enviando}>
        {enviando ? 'Guardando…' : textoBoton}
      </Boton>
    </form>
  );
}
