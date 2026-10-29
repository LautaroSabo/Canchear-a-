'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { hora, hoyEn, pesos } from '@/lib/formato';
import type { CategoriaProducto, Producto, ResumenCantina, VentaCantina } from '@/lib/tipos';
import { Aviso, Boton, Campo, Cargando, Casilla, EncabezadoPagina, Pestanas, Selector, Tarjeta } from '../ui';
import { CATEGORIAS, MEDIOS } from './cantina/comunes';
import { useProductos, Vendedor } from './cantina/Vendedor';
import { aCentavos, aTextoPesos, pesosValidos } from './config/comunes';
import { Dialogo } from './Dialogo';
import { alcanza, useClubActual } from './sesion';

type Seccion = 'mostrador' | 'ventas' | 'productos';

export function Cantina() {
  const [seccion, setSeccion] = useState<Seccion>('mostrador');
  const [aviso, setAviso] = useState<string | null>(null);
  const SECCIONES: { id: Seccion; nombre: string }[] = [
    { id: 'mostrador', nombre: 'Mostrador' },
    { id: 'ventas', nombre: 'Ventas de hoy' },
    { id: 'productos', nombre: 'Productos y stock' },
  ];
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <EncabezadoPagina titulo="Cantina" />
      <Pestanas
        id="cantina"
        etiqueta="Secciones de la cantina"
        valor={seccion}
        onCambio={(v) => {
          setSeccion(v);
          setAviso(null);
        }}
        opciones={SECCIONES.map((s) => ({ valor: s.id, etiqueta: s.nombre }))}
      />
      {aviso ? <Aviso tipo="ok">{aviso}</Aviso> : null}
      <div id="cantina-panel" role="tabpanel" aria-labelledby={`cantina-tab-${seccion}`}>
        {seccion === 'mostrador' ? (
          <Vendedor alVender={(v, destino) => setAviso(`Listo: ${pesos(v.total)}. ${destino}.`)} />
        ) : seccion === 'ventas' ? (
          <VentasDelDia />
        ) : (
          <Productos alHacer={setAviso} />
        )}
      </div>
    </div>
  );
}

function VentasDelDia() {
  const { clubId, zona } = useClubActual();
  const hoy = hoyEn(zona);
  const [anulando, setAnulando] = useState<VentaCantina | null>(null);
  const resumen = useQuery({
    queryKey: ['cantina', clubId, 'resumen', hoy],
    queryFn: () => panel.get<ResumenCantina>(`/clubs/${clubId}/cantina/resumen?fecha=${hoy}`),
  });
  const ventas = useQuery({
    queryKey: ['cantina', clubId, 'ventas', hoy],
    queryFn: () => panel.get<VentaCantina[]>(`/clubs/${clubId}/cantina/ventas?fecha=${hoy}`),
  });

  return (
    <div className="flex flex-col gap-4">
      {resumen.data ? (
        <Tarjeta className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-sm text-suave">Cobrado hoy</div>
            <div className="font-display text-3xl font-bold">{pesos(resumen.data.cobrado)}</div>
            <div className="text-sm text-medio">
              {Object.entries(resumen.data.cobradoPorMedio)
                .map(([m, v]) => `${MEDIOS[m as keyof typeof MEDIOS]} ${pesos(v ?? 0)}`)
                .join(' · ') || 'Sin ventas cobradas'}
            </div>
          </div>
          <div>
            <div className="text-sm text-suave">A cuenta de turnos</div>
            <div className="font-display text-3xl font-bold">{pesos(resumen.data.aCuentaDeTurnos)}</div>
            <div className="text-sm text-medio">Se cobra con el saldo de cada turno</div>
          </div>
          <div>
            <div className="text-sm text-suave">Más vendido</div>
            <div className="text-sm">
              {resumen.data.masVendidos.slice(0, 3).map((m) => (
                <div key={m.nombre}>
                  {m.cantidad} × {m.nombre}
                </div>
              ))}
            </div>
          </div>
          {resumen.data.stockBajo.length ? (
            <div className="sm:col-span-3">
              <Aviso tipo="ambar">
                Reponer: {resumen.data.stockBajo.map((p) => `${p.nombre} (quedan ${p.stock})`).join(', ')}
              </Aviso>
            </div>
          ) : null}
        </Tarjeta>
      ) : null}
      {ventas.isPending ? (
        <Cargando />
      ) : ventas.isError ? (
        <Aviso>{ventas.error.message}</Aviso>
      ) : ventas.data.length === 0 ? (
        <p className="text-sm text-suave">Todavía no hubo ventas hoy.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-linea rounded-xs border border-linea bg-superficie">
          {ventas.data.map((v) => (
            <li
              key={v.id}
              className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${v.anuladaEn ? 'text-suave' : ''}`}
            >
              <div className="min-w-0">
                <div className={`font-bold ${v.anuladaEn ? 'line-through' : ''}`}>
                  {hora(v.creadoEn, zona)} · {pesos(v.total)} ·{' '}
                  {v.medio ? MEDIOS[v.medio] : 'A cuenta del turno'}
                </div>
                <div className="text-sm text-medio">
                  {v.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', ')}
                </div>
                {v.anuladaEn ? <div className="text-sm">Anulada: {v.motivoAnulacion}</div> : null}
              </div>
              {v.anuladaEn ? null : (
                <Boton variante="fantasma" onClick={() => setAnulando(v)}>
                  Anular
                </Boton>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialogo abierto={anulando !== null} alCerrar={() => setAnulando(null)} titulo="Anular venta">
        {anulando ? <FormAnular venta={anulando} alAnular={() => setAnulando(null)} /> : null}
      </Dialogo>
    </div>
  );
}

export function FormAnular({ venta, alAnular }: { venta: VentaCantina; alAnular: () => void }) {
  const { clubId } = useClubActual();
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const anular = useMutation({
    mutationFn: () =>
      panel.post(`/clubs/${clubId}/cantina/ventas/${venta.id}/anular`, { motivo: motivo.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cantina', clubId] });
      qc.invalidateQueries({ queryKey: ['agenda', clubId] });
      if (venta.turnoId) qc.invalidateQueries({ queryKey: ['turno', clubId, venta.turnoId] });
      alAnular();
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        anular.mutate();
      }}
    >
      <p className="text-sm">
        {venta.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', ')} · {pesos(venta.total)}. Los
        productos vuelven al stock.
        {venta.medio ? ' Si ya se cobró, devolvé el dinero.' : ''}
      </p>
      <Campo
        etiqueta="Motivo"
        value={motivo}
        minLength={2}
        maxLength={300}
        onChange={(e) => setMotivo(e.target.value)}
        required
      />
      {anular.error ? <Aviso>{mensajeDe(anular.error)}</Aviso> : null}
      <Boton type="submit" variante="peligro" disabled={anular.isPending}>
        Anular venta
      </Boton>
    </form>
  );
}

function Productos({ alHacer }: { alHacer: (m: string) => void }) {
  const { rol } = useClubActual();
  const esAdmin = alcanza(rol, 'ADMIN');
  const productos = useProductos();
  const [dialogo, setDialogo] = useState<
    { tipo: 'reponer' | 'ajustar' | 'editar'; producto: Producto } | { tipo: 'nuevo' } | null
  >(null);
  const cerrar = (m?: string) => {
    setDialogo(null);
    if (m) alHacer(m);
  };

  return (
    <div className="flex flex-col gap-3">
      {esAdmin ? (
        <div>
          <Boton variante="secundario" onClick={() => setDialogo({ tipo: 'nuevo' })}>
            + Nuevo producto
          </Boton>
        </div>
      ) : null}
      {productos.isPending ? (
        <Cargando />
      ) : productos.isError ? (
        <Aviso>{productos.error.message}</Aviso>
      ) : (
        <ul className="flex flex-col divide-y divide-linea rounded-xs border border-linea bg-superficie">
          {productos.data.map((p) => {
            const bajo = p.controlaStock && p.stock <= p.stockMinimo;
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <div className="font-bold">{p.nombre}</div>
                  <div className="text-sm text-medio">
                    {CATEGORIAS[p.categoria]} · {pesos(p.precio)} ·{' '}
                    {p.controlaStock ? (
                      <span className={bajo ? 'font-bold text-ambar-texto' : ''}>
                        stock {p.stock}
                        {bajo ? ' (reponer)' : ''}
                      </span>
                    ) : (
                      'sin control de stock'
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  {p.controlaStock ? (
                    <Boton variante="fantasma" onClick={() => setDialogo({ tipo: 'reponer', producto: p })}>
                      Reponer
                    </Boton>
                  ) : null}
                  {esAdmin && p.controlaStock ? (
                    <Boton variante="fantasma" onClick={() => setDialogo({ tipo: 'ajustar', producto: p })}>
                      Ajustar
                    </Boton>
                  ) : null}
                  {esAdmin ? (
                    <Boton variante="fantasma" onClick={() => setDialogo({ tipo: 'editar', producto: p })}>
                      Editar
                    </Boton>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialogo
        abierto={dialogo !== null}
        alCerrar={() => setDialogo(null)}
        titulo={
          dialogo?.tipo === 'nuevo'
            ? 'Nuevo producto'
            : dialogo?.tipo === 'reponer'
              ? `Reponer ${dialogo.producto.nombre}`
              : dialogo?.tipo === 'ajustar'
                ? `Ajustar stock de ${dialogo.producto.nombre}`
                : `Editar ${dialogo?.producto.nombre ?? ''}`
        }
      >
        {dialogo?.tipo === 'reponer' || dialogo?.tipo === 'ajustar' ? (
          <FormStock tipo={dialogo.tipo} producto={dialogo.producto} alTerminar={cerrar} />
        ) : dialogo ? (
          <FormProducto producto={dialogo.tipo === 'editar' ? dialogo.producto : null} alTerminar={cerrar} />
        ) : null}
      </Dialogo>
    </div>
  );
}

function FormStock({
  tipo,
  producto,
  alTerminar,
}: {
  tipo: 'reponer' | 'ajustar';
  producto: Producto;
  alTerminar: (m: string) => void;
}) {
  const { clubId } = useClubActual();
  const qc = useQueryClient();
  const [cantidad, setCantidad] = useState(tipo === 'ajustar' ? String(producto.stock) : '');
  const [motivo, setMotivo] = useState('');
  const guardar = useMutation({
    mutationFn: () =>
      tipo === 'reponer'
        ? panel.post<{ stock: number }>(`/clubs/${clubId}/cantina/productos/${producto.id}/reposicion`, {
            cantidad: Number(cantidad),
            ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
          })
        : panel.post<{ stock: number }>(`/clubs/${clubId}/cantina/productos/${producto.id}/ajuste`, {
            stock: Number(cantidad),
            motivo: motivo.trim(),
          }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['cantina', clubId] });
      alTerminar(`${producto.nombre}: stock ${r.stock}.`);
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        guardar.mutate();
      }}
    >
      <p className="text-sm">Stock actual: {producto.stock}</p>
      <Campo
        etiqueta={tipo === 'reponer' ? 'Unidades que llegaron' : 'Unidades que hay (conteo)'}
        type="number"
        min={tipo === 'reponer' ? 1 : 0}
        value={cantidad}
        onChange={(e) => setCantidad(e.target.value)}
        required
      />
      <Campo
        etiqueta={tipo === 'reponer' ? 'Nota (opcional)' : 'Motivo'}
        value={motivo}
        maxLength={200}
        minLength={tipo === 'ajustar' ? 2 : undefined}
        placeholder={tipo === 'reponer' ? 'Proveedor, remito…' : 'Conteo, rotura, vencido…'}
        onChange={(e) => setMotivo(e.target.value)}
        required={tipo === 'ajustar'}
      />
      {guardar.error ? <Aviso>{mensajeDe(guardar.error)}</Aviso> : null}
      <Boton type="submit" disabled={guardar.isPending}>
        {tipo === 'reponer' ? 'Sumar al stock' : 'Guardar conteo'}
      </Boton>
    </form>
  );
}

function FormProducto({
  producto,
  alTerminar,
}: {
  producto: Producto | null;
  alTerminar: (m: string) => void;
}) {
  const { clubId } = useClubActual();
  const qc = useQueryClient();
  const [f, setF] = useState({
    nombre: producto?.nombre ?? '',
    categoria: producto?.categoria ?? ('BEBIDA' as CategoriaProducto),
    precio: producto ? aTextoPesos(producto.precio) : '',
    controlaStock: producto?.controlaStock ?? true,
    stockMinimo: String(producto?.stockMinimo ?? 0),
    stockInicial: '0',
    activo: producto?.activo ?? true,
  });
  const guardar = useMutation({
    mutationFn: () => {
      const datos = {
        nombre: f.nombre.trim(),
        categoria: f.categoria,
        precio: aCentavos(f.precio),
        controlaStock: f.controlaStock,
        stockMinimo: Number(f.stockMinimo),
        activo: f.activo,
      };
      return producto
        ? panel.patch(`/clubs/${clubId}/cantina/productos/${producto.id}`, datos)
        : panel.post(`/clubs/${clubId}/cantina/productos`, {
            ...datos,
            stockInicial: Number(f.stockInicial),
          });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cantina', clubId] });
      alTerminar(producto ? 'Producto actualizado.' : `${f.nombre.trim()} agregado.`);
    },
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (pesosValidos(f.precio)) guardar.mutate();
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
        etiqueta="Categoría"
        value={f.categoria}
        onChange={(e) => setF({ ...f, categoria: e.target.value as CategoriaProducto })}
      >
        {Object.entries(CATEGORIAS).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </Selector>
      <Campo
        etiqueta="Precio ($)"
        inputMode="decimal"
        value={f.precio}
        onChange={(e) => setF({ ...f, precio: e.target.value })}
        required
      />
      <div className="sm:col-span-2">
        <Casilla
          etiqueta="Controlar stock (no para alquileres)"
          checked={f.controlaStock}
          onChange={(e) => setF({ ...f, controlaStock: e.target.checked })}
        />
      </div>
      {f.controlaStock ? (
        <>
          {producto ? null : (
            <Campo
              etiqueta="Stock inicial"
              type="number"
              min={0}
              value={f.stockInicial}
              onChange={(e) => setF({ ...f, stockInicial: e.target.value })}
            />
          )}
          <Campo
            etiqueta="Avisar cuando queden"
            type="number"
            min={0}
            value={f.stockMinimo}
            onChange={(e) => setF({ ...f, stockMinimo: e.target.value })}
          />
        </>
      ) : null}
      {producto ? (
        <div className="sm:col-span-2">
          <Casilla
            etiqueta="A la venta"
            checked={f.activo}
            onChange={(e) => setF({ ...f, activo: e.target.checked })}
          />
        </div>
      ) : null}
      {f.precio !== '' && !pesosValidos(f.precio) ? (
        <div className="sm:col-span-2">
          <Aviso>Escribí el precio en pesos (ej. 2500).</Aviso>
        </div>
      ) : null}
      {guardar.error ? (
        <div className="sm:col-span-2">
          <Aviso>{mensajeDe(guardar.error)}</Aviso>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Boton type="submit" className="w-full" disabled={guardar.isPending}>
          {producto ? 'Guardar cambios' : 'Agregar producto'}
        </Boton>
      </div>
    </form>
  );
}
