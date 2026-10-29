'use client';

import { useEffect, useState } from 'react';
import { hoyEn } from '@/lib/formato';
import { Aviso, Cargando, EncabezadoPagina, Pestanas } from '../ui';
import { Canchas } from './config/Canchas';
import { Cobros } from './config/Cobros';
import { useConfig } from './config/comunes';
import { DiasEspeciales } from './config/DiasEspeciales';
import { General } from './config/General';
import { Horarios } from './config/Horarios';
import { Puntos } from './config/Puntos';
import { Sena } from './config/Sena';
import { Tarifas } from './config/Tarifas';
import { Usuarios } from './config/Usuarios';
import { alcanza, useClubActual } from './sesion';

const SECCIONES = [
  { id: 'canchas', nombre: 'Canchas' },
  { id: 'horarios', nombre: 'Horarios' },
  { id: 'tarifas', nombre: 'Tarifas' },
  { id: 'sena', nombre: 'Seña' },
  { id: 'dias', nombre: 'Feriados' },
  { id: 'puntos', nombre: 'Puntos' },
  { id: 'cobros', nombre: 'Cobros' },
  { id: 'club', nombre: 'Club' },
  { id: 'usuarios', nombre: 'Usuarios', soloDueno: true },
] as const;
type Seccion = (typeof SECCIONES)[number]['id'];

export function Configuracion() {
  const { rol, zona } = useClubActual();
  const config = useConfig();
  const esDueno = alcanza(rol, 'OWNER');
  const visibles = SECCIONES.filter((s) => !('soloDueno' in s) || esDueno);
  const [seccion, setSeccion] = useState<Seccion>('canchas');
  // La sección va en el hash para que un recargar o un link la mantenga.
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (SECCIONES.some((s) => s.id === h) && (h !== 'usuarios' || esDueno)) setSeccion(h as Seccion);
  }, [esDueno]);
  const ir = (s: Seccion) => {
    setSeccion(s);
    history.replaceState(null, '', `#${s}`);
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <EncabezadoPagina
        titulo="Configuración"
        bajada="Canchas, horarios, precios y reglas del club. Los cambios se ven al instante en la página de reservas."
      />
      {config.data?.avisos.length ? (
        <section className="flex flex-col gap-2" aria-label="Avisos de configuración">
          {config.data.avisos.map((a) => (
            <Aviso key={a.mensaje} tipo={a.nivel === 'error' ? 'error' : 'ambar'}>
              {a.mensaje}
            </Aviso>
          ))}
        </section>
      ) : null}
      <Pestanas
        id="config"
        etiqueta="Secciones de configuración"
        valor={seccion}
        onCambio={ir}
        opciones={visibles.map((s) => ({ valor: s.id, etiqueta: s.nombre }))}
      />
      <div
        id="config-panel"
        role="tabpanel"
        aria-labelledby={`config-tab-${seccion}`}
        className="flex flex-col gap-4"
      >
        {seccion === 'cobros' ? (
          <Cobros />
        ) : seccion === 'puntos' ? (
          <Puntos hoy={hoyEn(zona)} />
        ) : seccion === 'usuarios' ? (
          <Usuarios />
        ) : config.isPending ? (
          <Cargando />
        ) : config.isError ? (
          <Aviso>{config.error.message}</Aviso>
        ) : seccion === 'canchas' ? (
          <Canchas canchas={config.data.canchas} />
        ) : seccion === 'horarios' ? (
          <Horarios key={JSON.stringify(config.data.horarios)} horarios={config.data.horarios} />
        ) : seccion === 'tarifas' ? (
          <Tarifas tarifas={config.data.tarifas} canchas={config.data.canchas} hoy={hoyEn(zona)} />
        ) : seccion === 'sena' ? (
          <Sena reglas={config.data.reglas} canchas={config.data.canchas} />
        ) : seccion === 'dias' ? (
          <DiasEspeciales dias={config.data.diasEspeciales} />
        ) : (
          <General key={JSON.stringify(config.data.club)} club={config.data.club} />
        )}
      </div>
    </div>
  );
}
