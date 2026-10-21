'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorApi, pedir } from '@/lib/api';
import { fechaCorta } from '@/lib/formato';
import { Aviso, Boton, Campo } from '../ui';

const HORAS = [
  ...Array.from({ length: 16 }, (_, i) => `${String(i + 8).padStart(2, '0')}:00`),
  '00:00',
  '01:00',
  '02:00',
];

export function ListaEspera({ slug, fecha, tipo }: { slug: string; fecha: string; tipo: number }) {
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
    <section aria-labelledby="titulo-espera" className="mt-6 rounded-2xl border border-linea bg-white p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-[1_1_380px]">
          <h2 id="titulo-espera" className="text-[17px] font-bold">
            ¿No encontrás horario?
          </h2>
          <p className="mt-1 text-sm text-suave">
            Anotate en la lista de espera: si se libera un turno en tu franja, te lo guardamos y te avisamos
            por WhatsApp.
          </p>
        </div>
        {!abierta ? (
          <Boton variante="secundario" onClick={() => setAbierta(true)}>
            Anotarme en la lista de espera
          </Boton>
        ) : null}
      </div>

      {abierta && anotar.isSuccess ? (
        <div className="mt-4">
          <Aviso tipo="ok">
            Listo, te anotamos para el {fechaCorta(fecha)} entre las {f.desde} y las {f.hasta}. Si se libera
            un turno te escribimos.
          </Aviso>
        </div>
      ) : abierta ? (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            anotar.mutate();
          }}
        >
          <p className="text-sm font-semibold sm:col-span-2">
            Para el {fechaCorta(fecha)} · Fútbol {tipo}
          </p>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Desde
            <select
              value={f.desde}
              onChange={(e) => setF({ ...f, desde: e.target.value })}
              className="min-h-11 rounded-xl border border-[#c9d1cb] bg-white px-3 text-base font-normal"
            >
              {HORAS.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Hasta
            <select
              value={f.hasta}
              onChange={(e) => setF({ ...f, hasta: e.target.value })}
              className="min-h-11 rounded-xl border border-[#c9d1cb] bg-white px-3 text-base font-normal"
            >
              {HORAS.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
          </label>
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
