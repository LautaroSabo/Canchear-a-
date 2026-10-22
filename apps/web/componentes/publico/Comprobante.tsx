'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { API_URL, ErrorApi, mensajeDe, pedir } from '@/lib/api';
import { fechaCorta, fechaLocal, hora, pesos, reloj, segundosHasta } from '@/lib/formato';
import { useAhora, useEventosTurnos } from '@/lib/hooks';
import type { ClubPublico, ReservaPublica } from '@/lib/tipos';
import { IconoAlerta, IconoCheck, IconoReloj, IconoSubir } from '../iconos';
import { Aviso, Boton, Cargando, Numero, Tarjeta } from '../ui';
import { EncabezadoClub } from './EncabezadoClub';

export function Comprobante({ codigo }: { codigo: string }) {
  const qc = useQueryClient();
  const params = useSearchParams();
  // Mercado Pago vuelve con ?collection_status=approved (o status=approved).
  const volvioDeMp = ['approved', 'success'].includes(
    params.get('collection_status') ?? params.get('status') ?? '',
  );

  const reserva = useQuery({
    queryKey: ['reserva', codigo],
    queryFn: ({ signal }) => pedir<ReservaPublica>(`/public/reservas/${codigo}`, { signal }),
    // Mientras espera la seña, por si el evento en vivo no llega (red del celular).
    refetchInterval: (q) => (q.state.data?.estado === 'PRE_RESERVADO' ? 8000 : false),
  });
  const slug = reserva.data?.club.slug;
  const club = useQuery({
    queryKey: ['club', slug],
    queryFn: ({ signal }) => pedir<ClubPublico>(`/public/clubs/${slug}`, { signal }),
    enabled: Boolean(slug),
    staleTime: 5 * 60_000,
  });
  useEventosTurnos(
    slug && reserva.data?.estado === 'PRE_RESERVADO' ? `${API_URL}/public/clubs/${slug}/eventos` : null,
    () => qc.invalidateQueries({ queryKey: ['reserva', codigo] }),
  );

  if (reserva.isPending || (slug && club.isPending)) return <Cargando texto="Buscando tu reserva…" />;
  if (reserva.isError) {
    const noExiste = reserva.error instanceof ErrorApi && reserva.error.status === 404;
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <Aviso>{noExiste ? 'No encontramos esa reserva. Revisá el link.' : reserva.error.message}</Aviso>
      </main>
    );
  }
  const r = reserva.data;
  const c = club.data;
  const zona = c?.zonaHoraria ?? 'America/Argentina/Buenos_Aires';

  return (
    <>
      {c ? <EncabezadoClub club={c} /> : null}
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <Tarjeta>
          <EstadoReserva reserva={r} club={c} volvioDeMp={volvioDeMp} codigo={codigo} />
        </Tarjeta>
        <Tarjeta>
          <h2 className="text-lg font-bold">{r.cancha.nombre}</h2>
          <Numero className="mt-1 block text-[30px]">
            {fechaCorta(fechaLocal(r.inicio, zona))} · {hora(r.inicio, zona)} a {hora(r.fin, zona)}
          </Numero>
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-2 text-[15px]">
            <dt className="text-suave">A nombre de</dt>
            <dd className="font-semibold">{r.cliente.nombre}</dd>
            <dt className="text-suave">Precio del turno</dt>
            <dd className="font-semibold">{pesos(r.precioTotal)}</dd>
            {r.montoSena > 0 ? (
              <>
                <dt className="text-suave">Seña</dt>
                <dd className="font-semibold">{pesos(r.montoSena)}</dd>
              </>
            ) : null}
            <dt className="font-bold">Pagás en el club</dt>
            <dd className="font-bold">{pesos(r.saldoAPagar)}</dd>
          </dl>
          {c?.direccion ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.direccion)}`}
              className="mt-4 inline-flex min-h-11 items-center font-semibold text-cancha underline"
            >
              Cómo llegar
            </a>
          ) : null}
        </Tarjeta>
      </main>
    </>
  );
}

function EstadoReserva({
  reserva: r,
  club,
  volvioDeMp,
  codigo,
}: {
  reserva: ReservaPublica;
  club: ClubPublico | undefined;
  volvioDeMp: boolean;
  codigo: string;
}) {
  switch (r.estado) {
    case 'CONFIRMADO':
    case 'PRESENTE':
      return <Confirmada codigo={codigo} presente={r.estado === 'PRESENTE'} puntos={r.puntos} />;
    case 'PRE_RESERVADO':
      if (r.montoSena === 0) return <OfertaSinSena reserva={r} codigo={codigo} />;
      if (r.senaEnRevision) return <EnRevision reserva={r} />;
      return <PagarSena reserva={r} club={club} volvioDeMp={volvioDeMp} codigo={codigo} />;
    case 'EXPIRADO':
      return (
        <Final titulo="Se terminó el tiempo para pagar la seña" tono="rojo">
          El turno quedó libre otra vez.{' '}
          <Link className="font-semibold underline" href={`/${r.club.slug}`}>
            Volvé a la grilla
          </Link>{' '}
          por si sigue disponible.
        </Final>
      );
    case 'CANCELADO':
      return (
        <Final titulo="Esta reserva se canceló" tono="rojo">
          Si tenías una seña paga, te la devolvemos y te avisamos por WhatsApp.
        </Final>
      );
    case 'AUSENTE':
      return (
        <Final titulo="El club marcó este turno como ausente" tono="rojo">
          Si es un error, escribile al club.
        </Final>
      );
  }
}

function Final({ titulo, tono, children }: { titulo: string; tono: 'rojo'; children: React.ReactNode }) {
  return (
    <div className={tono === 'rojo' ? 'text-[#7a1a0c]' : ''}>
      <p className="flex items-center gap-2 text-lg font-bold">
        <IconoAlerta /> {titulo}
      </p>
      <p className="mt-1 text-[15px] text-medio">{children}</p>
    </div>
  );
}

function Temporizador({ hasta, texto }: { hasta: string; texto: string }) {
  const ahora = useAhora();
  const qc = useQueryClient();
  const segundos = segundosHasta(hasta, ahora);
  useEffect(() => {
    if (segundos === 0) qc.invalidateQueries({ queryKey: ['reserva'] });
  }, [segundos, qc]);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#e8b04b] bg-ambar-fondo px-4 py-3 text-ambar-texto">
      <IconoReloj tamano={22} />
      <div>
        <p className="text-sm font-semibold">{texto}</p>
        <Numero className="text-[30px]" aria-live="off">
          {reloj(segundos)}
        </Numero>
      </div>
    </div>
  );
}

function PagarSena({
  reserva: r,
  club,
  volvioDeMp,
  codigo,
}: {
  reserva: ReservaPublica;
  club: ClubPublico | undefined;
  volvioDeMp: boolean;
  codigo: string;
}) {
  const qc = useQueryClient();
  const mp = useMutation({
    mutationFn: () =>
      pedir<{ urlCheckout: string }>(`/public/reservas/${codigo}/mercadopago`, { metodo: 'POST' }),
    onSuccess: ({ urlCheckout }) => {
      window.location.href = urlCheckout;
    },
  });
  const subir = useMutation({
    mutationFn: (archivo: File) => {
      const datos = new FormData();
      datos.append('comprobante', archivo);
      return pedir(`/public/reservas/${codigo}/transferencia`, { metodo: 'POST', cuerpo: datos });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reserva', codigo] }),
  });
  const transferencia = club?.mediosPago.transferencia;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Falta pagar la seña</h1>
        <p className="mt-1 text-[15px] text-medio">
          Pagala antes de que termine el tiempo. Si no, la cancha se libera para otra persona.
        </p>
      </div>
      {r.expiraEn ? <Temporizador hasta={r.expiraEn} texto="Te guardamos el turno" /> : null}
      {volvioDeMp ? (
        <Aviso tipo="info">Estamos confirmando tu pago con Mercado Pago. Esto tarda unos segundos…</Aviso>
      ) : null}

      {club?.mediosPago.mercadoPago ? (
        <Boton variante="mp" grande disabled={mp.isPending} onClick={() => mp.mutate()}>
          {mp.isPending ? 'Abriendo Mercado Pago…' : `Pagar ${pesos(r.montoSena)} con Mercado Pago`}
        </Boton>
      ) : null}
      {mp.error ? <Aviso>{mensajeDe(mp.error)}</Aviso> : null}

      {transferencia ? (
        <>
          {club?.mediosPago.mercadoPago ? (
            <div className="flex items-center gap-3 text-[13px] text-suave">
              <span className="h-px flex-1 bg-linea" />o por transferencia
              <span className="h-px flex-1 bg-linea" />
            </div>
          ) : null}
          <div className="rounded-xl bg-fondo px-4 py-3 text-sm leading-relaxed">
            {transferencia.alias ? <DatoCopiable etiqueta="Alias" valor={transferencia.alias} /> : null}
            {transferencia.cbu ? <DatoCopiable etiqueta="CBU/CVU" valor={transferencia.cbu} /> : null}
            {transferencia.titular ? <div>Titular: {transferencia.titular}</div> : null}
            <div>
              Monto: <strong>{pesos(r.montoSena)}</strong>
            </div>
          </div>
          <label className="relative flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-[#9aa59e] text-sm font-semibold hover:bg-fondo">
            <IconoSubir tamano={18} />
            {subir.isPending ? 'Subiendo…' : 'Subir comprobante (foto o PDF)'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              disabled={subir.isPending}
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                if (archivo) subir.mutate(archivo);
                e.target.value = '';
              }}
            />
          </label>
          {subir.error ? <Aviso>{mensajeDe(subir.error)}</Aviso> : null}
        </>
      ) : null}
    </div>
  );
}

function DatoCopiable({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2">
      <span>
        {etiqueta}: <strong>{valor}</strong>
      </span>
      <button
        type="button"
        className="min-h-9 rounded-lg px-2 text-[13px] font-semibold text-cancha hover:bg-cancha-claro"
        onClick={async () => {
          await navigator.clipboard?.writeText(valor);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        }}
      >
        {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function EnRevision({ reserva: r }: { reserva: ReservaPublica }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-[#7fb3db] bg-azul-fondo p-4 text-azul-texto">
        <p className="font-bold">Comprobante recibido</p>
        <p className="mt-1 text-sm">
          El club lo está revisando. Te avisamos por WhatsApp apenas lo confirmen.
        </p>
      </div>
      {r.expiraEn ? <Temporizador hasta={r.expiraEn} texto="Turno guardado mientras lo revisan" /> : null}
    </div>
  );
}

function OfertaSinSena({ reserva: r, codigo }: { reserva: ReservaPublica; codigo: string }) {
  const qc = useQueryClient();
  const aceptar = useMutation({
    mutationFn: () => pedir(`/public/reservas/${codigo}/confirmar`, { metodo: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reserva', codigo] }),
  });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">¡Se liberó un turno para vos!</h1>
        <p className="mt-1 text-[15px] text-medio">
          Estabas en la lista de espera. Confirmalo antes de que termine el tiempo.
        </p>
      </div>
      {r.expiraEn ? <Temporizador hasta={r.expiraEn} texto="Te lo guardamos" /> : null}
      <Boton grande disabled={aceptar.isPending} onClick={() => aceptar.mutate()}>
        {aceptar.isPending ? 'Confirmando…' : 'Lo quiero'}
      </Boton>
      {aceptar.error ? <Aviso>{mensajeDe(aceptar.error)}</Aviso> : null}
    </div>
  );
}

function Confirmada({
  codigo,
  presente,
  puntos,
}: {
  codigo: string;
  presente: boolean;
  puntos: ReservaPublica['puntos'];
}) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    // El QR lleva la URL de este comprobante: el escáner del club extrae el código.
    QRCode.toString(`${window.location.origin}/r/${codigo}`, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then(setSvg)
      .catch(() => setSvg(null));
  }, [codigo]);
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-xl font-bold text-cancha-oscuro">
        <IconoCheck tamano={26} /> {presente ? '¡A jugar! Ya hiciste el check-in' : '¡Turno confirmado!'}
      </p>
      {puntos ? (
        <p className="rounded-xl bg-cancha-suave px-4 py-3 text-[15px] text-cancha-oscuro">
          Sumaste <strong>{puntos.ganados} puntos</strong> con este partido. Tenés {puntos.saldo} en total
          para canjear en el club.
        </p>
      ) : null}
      {!presente ? (
        <>
          <p className="text-[15px] text-medio">
            Mostrá este QR al llegar. También te lo mandamos por WhatsApp.
          </p>
          <div className="flex justify-center rounded-xl border border-linea p-4">
            {svg ? (
              <div
                role="img"
                aria-label="Código QR de la reserva"
                className="size-52 [&>svg]:size-full"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generado localmente por la librería qrcode a partir de nuestra URL.
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : (
              <div className="size-52" />
            )}
          </div>
          <p className="text-center text-xs tracking-wide text-suave">
            Código {codigo.slice(0, 4).toUpperCase()}-{codigo.slice(4, 8).toUpperCase()}
          </p>
        </>
      ) : null}
    </div>
  );
}
