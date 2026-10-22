'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import type { ConfigFidelizacion, Premio, PromocionPuntos, TipoPremio } from '@/lib/tipos';
import { Aviso, Boton, Campo, Cargando, Casilla, Selector, Tarjeta } from '../../ui';
import { detallePremio, TIPOS_PREMIO } from '../Clientes';
import { Dialogo } from '../Dialogo';
import { useClubActual } from '../sesion';
import { aCentavos, aTextoPesos, DIAS, franjaTexto, ORDEN_SEMANA, pesosValidos, useGuardar } from './comunes';

export function Puntos({ hoy }: { hoy: string }) {
  const { clubId } = useClubActual();
  const config = useQuery({
    queryKey: ['fidelizacion', clubId],
    queryFn: () => panel.get<ConfigFidelizacion>(`/clubs/${clubId}/fidelizacion`),
  });
  if (config.isPending) return <Cargando />;
  if (config.isError) return <Aviso>{config.error.message}</Aviso>;
  return (
    <>
      <Base key={config.data.puntosPorPartido} actual={config.data.puntosPorPartido} />
      <Promociones promociones={config.data.promociones} hoy={hoy} />
      <Premios premios={config.data.premios} />
    </>
  );
}

function Base({ actual }: { actual: number }) {
  const [puntos, setPuntos] = useState(String(actual));
  const guardar = useGuardar((clubId) =>
    panel.put(`/clubs/${clubId}/fidelizacion/puntos-por-partido`, { puntos: Number(puntos) }),
  );
  return (
    <Tarjeta>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          guardar.mutate();
        }}
      >
        <h2 className="text-lg font-bold">Puntos por partido</h2>
        <p className="text-sm text-suave">
          Se suman al hacer el check-in. El cliente los ve en su comprobante y los canjea en el club. Con 0,
          el club no usa puntos.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Campo
            etiqueta="Puntos por partido"
            type="number"
            min={0}
            max={10000}
            value={puntos}
            onChange={(e) => setPuntos(e.target.value)}
            required
          />
          <Boton type="submit" disabled={guardar.isPending || puntos === String(actual)}>
            Guardar
          </Boton>
        </div>
        {guardar.error ? <Aviso>{mensajeDe(guardar.error)}</Aviso> : null}
      </form>
    </Tarjeta>
  );
}

function Promociones({ promociones, hoy }: { promociones: PromocionPuntos[]; hoy: string }) {
  const [editando, setEditando] = useState<PromocionPuntos | 'nueva' | null>(null);
  const borrar = useGuardar((clubId, id: string) =>
    panel.borrar(`/clubs/${clubId}/fidelizacion/promociones/${id}`),
  );
  return (
    <Tarjeta className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Promociones de puntos</h2>
        <Boton variante="secundario" onClick={() => setEditando('nueva')}>
          Agregar promoción
        </Boton>
      </div>
      <p className="text-sm text-suave">
        Para llenar horarios flojos: “martes de 10 a 17, puntos x2”. Si aplican varias, se usa la que más da.
      </p>
      {borrar.error ? <Aviso>{mensajeDe(borrar.error)}</Aviso> : null}
      <ul className="flex flex-col divide-y divide-linea">
        {promociones.map((p) => (
          <li
            key={p.id}
            className={`flex flex-wrap items-center justify-between gap-2 py-2.5 ${p.activa ? '' : 'text-suave'}`}
          >
            <div>
              <div className="font-bold">
                {p.nombre} · x{p.multiplicador}
                {p.puntosExtra ? ` +${p.puntosExtra}` : ''}
              </div>
              <div className="text-sm text-medio">
                {p.diaSemana === null ? 'Todos los días' : DIAS[p.diaSemana]} ·{' '}
                {franjaTexto(p.horaDesde, p.horaHasta)}
                {p.vigenteHasta && p.vigenteHasta < hoy ? ' · terminada' : ''}
                {p.activa ? '' : ' · pausada'}
              </div>
            </div>
            <div className="flex gap-1">
              <Boton variante="fantasma" onClick={() => setEditando(p)}>
                Editar
              </Boton>
              <Boton variante="fantasma" disabled={borrar.isPending} onClick={() => borrar.mutate(p.id)}>
                Borrar
              </Boton>
            </div>
          </li>
        ))}
      </ul>
      <Dialogo
        abierto={editando !== null}
        alCerrar={() => setEditando(null)}
        titulo={editando === 'nueva' ? 'Nueva promoción' : 'Editar promoción'}
      >
        {editando ? (
          <FormPromocion
            promo={editando === 'nueva' ? null : editando}
            hoy={hoy}
            alGuardar={() => setEditando(null)}
          />
        ) : null}
      </Dialogo>
    </Tarjeta>
  );
}

function FormPromocion({
  promo,
  hoy,
  alGuardar,
}: {
  promo: PromocionPuntos | null;
  hoy: string;
  alGuardar: () => void;
}) {
  const [f, setF] = useState({
    nombre: promo?.nombre ?? '',
    diaSemana: promo?.diaSemana === null || !promo ? '' : String(promo.diaSemana),
    todoElDia: !promo?.horaDesde,
    horaDesde: promo?.horaDesde ?? '10:00',
    horaHasta: promo?.horaHasta ?? '17:00',
    multiplicador: String(promo?.multiplicador ?? 2),
    puntosExtra: String(promo?.puntosExtra ?? 0),
    vigenteDesde: promo?.vigenteDesde ?? hoy,
    vigenteHasta: promo?.vigenteHasta ?? '',
    activa: promo?.activa ?? true,
  });
  const guardar = useGuardar((clubId) => {
    const cuerpo = {
      nombre: f.nombre.trim(),
      diaSemana: f.diaSemana === '' ? null : Number(f.diaSemana),
      horaDesde: f.todoElDia ? null : f.horaDesde,
      horaHasta: f.todoElDia ? null : f.horaHasta,
      multiplicador: Number(f.multiplicador.replace(',', '.')),
      puntosExtra: Number(f.puntosExtra),
      vigenteDesde: f.vigenteDesde,
      vigenteHasta: f.vigenteHasta || null,
      activa: f.activa,
    };
    return promo
      ? panel.put(`/clubs/${clubId}/fidelizacion/promociones/${promo.id}`, cuerpo)
      : panel.post(`/clubs/${clubId}/fidelizacion/promociones`, cuerpo);
  }, alGuardar);
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
          maxLength={60}
          onChange={(e) => setF({ ...f, nombre: e.target.value })}
          required
        />
      </div>
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
      <div className="sm:self-end">
        <Casilla
          etiqueta="Todo el día"
          checked={f.todoElDia}
          onChange={(e) => setF({ ...f, todoElDia: e.target.checked })}
        />
      </div>
      {f.todoElDia ? null : (
        <>
          <Campo
            etiqueta="Turnos desde"
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
          />
        </>
      )}
      <Campo
        etiqueta="Multiplicador"
        inputMode="decimal"
        value={f.multiplicador}
        onChange={(e) => setF({ ...f, multiplicador: e.target.value })}
        required
        ayuda="2 = el doble de puntos; 1,5 = la mitad más."
      />
      <Campo
        etiqueta="Puntos extra"
        type="number"
        min={0}
        value={f.puntosExtra}
        onChange={(e) => setF({ ...f, puntosExtra: e.target.value })}
      />
      <Campo
        etiqueta="Desde"
        type="date"
        value={f.vigenteDesde}
        onChange={(e) => setF({ ...f, vigenteDesde: e.target.value })}
        required
      />
      <Campo
        etiqueta="Hasta (opcional)"
        type="date"
        value={f.vigenteHasta}
        onChange={(e) => setF({ ...f, vigenteHasta: e.target.value })}
      />
      <div className="sm:col-span-2">
        <Casilla
          etiqueta="Activa"
          checked={f.activa}
          onChange={(e) => setF({ ...f, activa: e.target.checked })}
        />
      </div>
      {guardar.error ? (
        <div className="sm:col-span-2">
          <Aviso>{mensajeDe(guardar.error)}</Aviso>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Boton type="submit" className="w-full" disabled={guardar.isPending}>
          {promo ? 'Guardar cambios' : 'Agregar promoción'}
        </Boton>
      </div>
    </form>
  );
}

function Premios({ premios }: { premios: Premio[] }) {
  const [editando, setEditando] = useState<Premio | 'nuevo' | null>(null);
  return (
    <Tarjeta className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Premios</h2>
        <Boton variante="secundario" onClick={() => setEditando('nuevo')}>
          Agregar premio
        </Boton>
      </div>
      <ul className="flex flex-col divide-y divide-linea">
        {premios.map((p) => (
          <li
            key={p.id}
            className={`flex flex-wrap items-center justify-between gap-2 py-2.5 ${p.activo ? '' : 'text-suave'}`}
          >
            <div>
              <div className="font-bold">
                {p.nombre} · {p.costoPuntos} pts
              </div>
              <div className="text-sm text-medio">
                {detallePremio(p)}
                {p.stock !== null ? ` · quedan ${p.stock}` : ''}
                {p.activo ? '' : ' · no disponible'}
              </div>
            </div>
            <Boton variante="fantasma" onClick={() => setEditando(p)}>
              Editar
            </Boton>
          </li>
        ))}
      </ul>
      <Dialogo
        abierto={editando !== null}
        alCerrar={() => setEditando(null)}
        titulo={editando === 'nuevo' ? 'Nuevo premio' : 'Editar premio'}
      >
        {editando ? (
          <FormPremio premio={editando === 'nuevo' ? null : editando} alGuardar={() => setEditando(null)} />
        ) : null}
      </Dialogo>
    </Tarjeta>
  );
}

function FormPremio({ premio, alGuardar }: { premio: Premio | null; alGuardar: () => void }) {
  const [f, setF] = useState({
    nombre: premio?.nombre ?? '',
    descripcion: premio?.descripcion ?? '',
    costoPuntos: String(premio?.costoPuntos ?? 100),
    tipo: premio?.tipo ?? ('DESCUENTO_PORCENTAJE' as TipoPremio),
    valor: premio
      ? premio.tipo === 'DESCUENTO_MONTO'
        ? aTextoPesos(premio.valor)
        : String(premio.valor)
      : '10',
    limitado: premio ? premio.stock !== null : false,
    stock: String(premio?.stock ?? 10),
    activo: premio?.activo ?? true,
  });
  const valorOk =
    f.tipo === 'DESCUENTO_PORCENTAJE'
      ? /^\d{1,3}$/.test(f.valor)
      : f.tipo === 'DESCUENTO_MONTO'
        ? pesosValidos(f.valor)
        : true;
  const guardar = useGuardar((clubId) => {
    const cuerpo = {
      nombre: f.nombre.trim(),
      descripcion: f.descripcion.trim() || null,
      costoPuntos: Number(f.costoPuntos),
      tipo: f.tipo,
      valor:
        f.tipo === 'DESCUENTO_MONTO'
          ? aCentavos(f.valor)
          : f.tipo === 'DESCUENTO_PORCENTAJE'
            ? Number(f.valor)
            : 0,
      stock: f.limitado ? Number(f.stock) : null,
      activo: f.activo,
    };
    return premio
      ? panel.put(`/clubs/${clubId}/fidelizacion/premios/${premio.id}`, cuerpo)
      : panel.post(`/clubs/${clubId}/fidelizacion/premios`, cuerpo);
  }, alGuardar);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valorOk) guardar.mutate();
      }}
    >
      <div className="sm:col-span-2">
        <Campo
          etiqueta="Nombre"
          value={f.nombre}
          maxLength={80}
          onChange={(e) => setF({ ...f, nombre: e.target.value })}
          required
        />
      </div>
      <Selector
        etiqueta="Tipo"
        value={f.tipo}
        onChange={(e) => setF({ ...f, tipo: e.target.value as TipoPremio })}
      >
        {Object.entries(TIPOS_PREMIO).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </Selector>
      <Campo
        etiqueta="Cuesta (puntos)"
        type="number"
        min={1}
        value={f.costoPuntos}
        onChange={(e) => setF({ ...f, costoPuntos: e.target.value })}
        required
      />
      {f.tipo === 'DESCUENTO_PORCENTAJE' || f.tipo === 'DESCUENTO_MONTO' ? (
        <Campo
          etiqueta={f.tipo === 'DESCUENTO_PORCENTAJE' ? 'Descuento (%)' : 'Descuento ($)'}
          inputMode="decimal"
          value={f.valor}
          onChange={(e) => setF({ ...f, valor: e.target.value })}
          required
          aria-invalid={!valorOk}
        />
      ) : null}
      <div className="sm:col-span-2">
        <Campo
          etiqueta="Descripción (opcional)"
          value={f.descripcion}
          maxLength={300}
          onChange={(e) => setF({ ...f, descripcion: e.target.value })}
        />
      </div>
      <Casilla
        etiqueta="Cantidad limitada"
        checked={f.limitado}
        onChange={(e) => setF({ ...f, limitado: e.target.checked })}
      />
      {f.limitado ? (
        <Campo
          etiqueta="Quedan"
          type="number"
          min={0}
          value={f.stock}
          onChange={(e) => setF({ ...f, stock: e.target.value })}
        />
      ) : null}
      <div className="sm:col-span-2">
        <Casilla
          etiqueta="Disponible para canjear"
          checked={f.activo}
          onChange={(e) => setF({ ...f, activo: e.target.checked })}
        />
      </div>
      {guardar.error ? (
        <div className="sm:col-span-2">
          <Aviso>{mensajeDe(guardar.error)}</Aviso>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Boton type="submit" className="w-full" disabled={guardar.isPending}>
          {premio ? 'Guardar cambios' : 'Agregar premio'}
        </Boton>
      </div>
    </form>
  );
}
