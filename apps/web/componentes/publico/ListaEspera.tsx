'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorApi, pedir } from '@/lib/api';
import { fechaCorta } from '@/lib/formato';
import { Aviso, Boton, Campo, Selector } from '../ui';

const HORAS = [
  ...Array.from({ length: 16 }, (_, i) => `${String(i + 8).padStart(2, '0')}:00`),
  '00:00',
  '01:00',
  '02:00',
];

export function ListaEspera({
  slug,
  fecha,
  tipo,
  destacada = false,
}: {
  slug: string;
  fecha: string;
  tipo: number;
  /** El día está completo: la lista de espera es la salida principal. */
  destacada?: boolean;
}) {
  const [abierta, setAbierta] = useState(false);
  const [f, setF] = useState({ desde: '19:00', hasta: '23:00', nombre: '', telefono: '' });

  const anotar = useMutation({
    mutationFn: () =>
      pedir<{ id: string }>(`/public/clubs/${slug}/lista-espera`, {
        metodo: 'POST',
        json: {
          cliente: { nombre: f.nombre.trim(), telefono: f.telefono.trim() },
          fecha,
          desde: f.desde,
          hasta: f.hasta,
          jugadores: tipo,
        },
      }),
  });

  return (
    <section
      aria-labelledby="titulo-espera"
      className={`mt-12 border-t pt-8 ${destacada ? 'border-cesped' : 'border-linea'}`}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <h2 id="titulo-espera" className="font-display text-[28px] leading-none font-bold uppercase">
            ¿No encontrás horario?
          </h2>
          <p className="mt-2 text-base text-tenue">
            Anotate en la lista de espera: si se libera un turno en tu franja, te lo guardamos y te avisamos
            por WhatsApp.
          </p>
        </div>
        {!abierta ? (
          <Boton variante={destacada ? 'primario' : 'secundario'} onClick={() => setAbierta(true)}>
            Anotarme en la lista de espera
          </Boton>
        ) : null}
      </div>

      {abierta && anotar.isSuccess ? (
        <div className="mt-5 max-w-xl">
          <Aviso tipo="ok">
            Listo, te anotamos para el {fechaCorta(fecha)} entre las {f.desde} y las {f.hasta}. Si se libera
            un turno te escribimos.
          </Aviso>
        </div>
      ) : abierta ? (
        <form
          className="mt-5 grid max-w-xl gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            anotar.mutate();
          }}
        >
          <p className="text-base font-semibold sm:col-span-2">
            Para el {fechaCorta(fecha)} · Fútbol {tipo}
          </p>
          <Selector etiqueta="Desde" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })}>
            {HORAS.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </Selector>
          <Selector etiqueta="Hasta" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })}>
            {HORAS.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </Selector>
          <Campo
            etiqueta="Nombre"
            autoComplete="name"
            value={f.nombre}
            onChange={(e) => setF({ ...f, nombre: e.target.value })}
            required
          />
          <Campo
            etiqueta="WhatsApp"
            type="tel"
            autoComplete="tel"
            value={f.telefono}
            onChange={(e) => setF({ ...f, telefono: e.target.value })}
            required
          />
          {anotar.error ? (
            <div className="sm:col-span-2">
              <Aviso>
                {anotar.error instanceof ErrorApi ? anotar.error.message : 'No pudimos anotarte.'}
              </Aviso>
            </div>
          ) : null}
          <div className="flex gap-2 sm:col-span-2">
            <Boton type="submit" disabled={anotar.isPending}>
              {anotar.isPending ? 'Anotando…' : 'Anotarme'}
            </Boton>
            <Boton variante="fantasma" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
          </div>
        </form>
      ) : null}
    </section>
  );
}
