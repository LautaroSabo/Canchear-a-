'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { API_URL, ErrorApi, mensajeDe, pedir } from '@/lib/api';
import { fechaCorta, fechaLocal, hora, pesos, reloj, segundosHasta } from '@/lib/formato';
import { useAhora, useEventosTurnos } from '@/lib/hooks';
import type { ClubPublico, ReservaPublica } from '@/lib/tipos';
import { IconoCalendario, IconoMapa, IconoSubir, IconoWhatsApp } from '../iconos';
import { Aviso, Boton, Cargando, Copiable, Numero } from '../ui';
import { EncabezadoClub } from './EncabezadoClub';

const ZONA_POR_DEFECTO = 'America/Argentina/Buenos_Aires';

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

  if (reserva.isPending || (slug && club.isPending)) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <Cargando texto="Buscando tu reserva…" />
      </main>
    );
  }
  if (reserva.isError) {
    const noExiste = reserva.error instanceof ErrorApi && reserva.error.status === 404;
    return (
      <main className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-16">
        <h1 className="font-display text-[44px] leading-none font-extrabold uppercase">
          {noExiste ? 'No encontramos esa reserva' : 'No pudimos cargar tu reserva'}
        </h1>
        <p className="text-base text-tenue">
          {noExiste
            ? 'Revisá que el link esté completo: es el que te llegó por WhatsApp.'
            : reserva.error.message}
        </p>
      </main>
    );
  }
  const r = reserva.data;
  const c = club.data;
  const zona = c?.zonaHoraria ?? ZONA_POR_DEFECTO;

  return (
    <>
      <EncabezadoClub
        club={{ ...(c ?? { nombre: r.club.nombre, direccion: null, telefono: null }), slug: r.club.slug }}
        compacto
      />
      <main className="mx-auto flex max-w-xl flex-col gap-8 px-4 pt-8 pb-16">
        <EstadoReserva reserva={r} club={c} volvioDeMp={volvioDeMp} codigo={codigo} />
        <Detalle reserva={r} club={c} zona={zona} codigo={codigo} />
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
        <Banda titulo="Se terminó el tiempo para pagar la seña" tono="error">
          El turno quedó libre otra vez.{' '}
          <Link className="font-semibold text-tinta underline" href={`/${r.club.slug}`}>
            Volvé a ver los horarios
          </Link>{' '}
          por si sigue disponible.
        </Banda>
      );
    case 'CANCELADO':
      return (
        <Banda titulo="Esta reserva se canceló" tono="error">
          Si tenías una seña paga, te la devolvemos y te avisamos por WhatsApp.
        </Banda>
      );
    case 'AUSENTE':
      return (
        <Banda titulo="El club marcó este turno como ausente" tono="error">
          Si es un error, escribile al club.
        </Banda>
      );
  }
}

const TONOS = {
  ok: 'border-ok-borde text-ok-texto',
  aviso: 'border-aviso-borde text-aviso-texto',
  info: 'border-info-borde text-info-texto',
  error: 'border-error-borde text-error-texto',
};

/** El estado es lo más grande de la página: título, una línea y lo que haya que hacer. */
function Banda({
  titulo,
  tono,
  children,
  extra,
}: {
  titulo: string;
  tono: keyof typeof TONOS;
  children?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <section aria-labelledby="estado-reserva" className="flex flex-col gap-5">
      <div className={`border-l-4 pl-4 ${TONOS[tono]}`}>
        <h1
          id="estado-reserva"
          className="font-display text-[44px] leading-[0.95] font-extrabold uppercase sm:text-[56px]"
        >
          {titulo}
        </h1>
        {children ? <p className="mt-3 text-base text-tinta">{children}</p> : null}
      </div>
      {extra}
    </section>
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
    <div className="flex items-center justify-between gap-3 border border-aviso-borde bg-aviso-fondo px-4 py-3 text-aviso-texto">
      <p className="text-base font-semibold">{texto}</p>
      <Numero className="text-[40px]" aria-live="off">
        {reloj(segundos)}
      </Numero>
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
  const conMp = Boolean(club?.mediosPago.mercadoPago);

  return (
    <Banda
      titulo="Falta pagar la seña"
      tono="aviso"
      extra={
        <>
          {r.expiraEn ? <Temporizador hasta={r.expiraEn} texto="Te guardamos el turno" /> : null}
          {volvioDeMp ? (
            <Aviso tipo="info">Estamos confirmando tu pago con Mercado Pago. Esto tarda unos segundos…</Aviso>
          ) : null}

          {conMp ? (
            <section
              aria-labelledby="pago-mp"
              className="flex flex-col gap-3 border border-linea bg-superficie p-5"
            >
              <div>
                <h2 id="pago-mp" className="text-lg font-semibold">
                  Mercado Pago
                </h2>
                <p className="text-sm text-tenue">Se confirma al instante.</p>
              </div>
              <Boton variante="mp" grande disabled={mp.isPending} onClick={() => mp.mutate()}>
                {mp.isPending ? 'Abriendo Mercado Pago…' : `Pagar ${pesos(r.montoSena)} con Mercado Pago`}
              </Boton>
              {mp.error ? <Aviso>{mensajeDe(mp.error)}</Aviso> : null}
            </section>
          ) : null}

          {transferencia ? (
            <section
              aria-labelledby="pago-transferencia"
              className="flex flex-col gap-3 border border-linea bg-superficie p-5"
            >
              <div>
                <h2 id="pago-transferencia" className="text-lg font-semibold">
                  {conMp ? 'O por transferencia' : 'Transferencia'}
                </h2>
                <p className="text-sm text-tenue">
                  La valida el club. Transferí la seña y subí el comprobante acá.
                </p>
              </div>
              <div>
                {transferencia.alias ? <Copiable etiqueta="Alias" valor={transferencia.alias} /> : null}
                {transferencia.cbu ? <Copiable etiqueta="CBU/CVU" valor={transferencia.cbu} /> : null}
                <Copiable
                  etiqueta="Monto"
                  valor={String(Math.round(r.montoSena / 100))}
                  mostrar={pesos(r.montoSena)}
                />
                {transferencia.titular ? (
                  <p className="pt-2 text-sm text-tenue">A nombre de {transferencia.titular}</p>
                ) : null}
              </div>
              <label className="flex min-h-13 cursor-pointer items-center justify-center gap-2 rounded-xs border border-dashed border-borde-control text-base font-semibold hover:border-tinta focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-foco">
                <IconoSubir tamano={20} />
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
            </section>
          ) : null}
        </>
      }
    >
      Pagala antes de que termine el tiempo. Si no, la cancha se libera para otra persona.
    </Banda>
  );
}

function EnRevision({ reserva: r }: { reserva: ReservaPublica }) {
  return (
    <Banda
      titulo="Comprobante recibido"
      tono="info"
      extra={
        r.expiraEn ? <Temporizador hasta={r.expiraEn} texto="Turno guardado mientras lo revisan" /> : null
      }
    >
      El turno es tuyo mientras el club revisa la transferencia. Te avisamos por WhatsApp apenas la confirmen.
    </Banda>
  );
}

function OfertaSinSena({ reserva: r, codigo }: { reserva: ReservaPublica; codigo: string }) {
  const qc = useQueryClient();
  const aceptar = useMutation({
    mutationFn: () => pedir(`/public/reservas/${codigo}/confirmar`, { metodo: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reserva', codigo] }),
  });
  return (
    <Banda
      titulo="¡Se liberó un turno para vos!"
      tono="ok"
      extra={
        <>
          {r.expiraEn ? <Temporizador hasta={r.expiraEn} texto="Te lo guardamos" /> : null}
          <Boton grande disabled={aceptar.isPending} onClick={() => aceptar.mutate()}>
            {aceptar.isPending ? 'Confirmando…' : 'Lo quiero'}
          </Boton>
          {aceptar.error ? <Aviso>{mensajeDe(aceptar.error)}</Aviso> : null}
        </>
      }
    >
      Estabas en la lista de espera. Confirmalo antes de que termine el tiempo.
    </Banda>
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
    if (presente) return;
    // El QR lleva la URL de este comprobante: el escáner del club extrae el código.
    import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toString(`${window.location.origin}/r/${codigo}`, {
          type: 'svg',
          margin: 1,
          errorCorrectionLevel: 'M',
        }),
      )
      .then(setSvg)
      .catch(() => setSvg(null));
  }, [codigo, presente]);
  return (
    <Banda
      titulo={presente ? '¡A jugar! Ya registramos tu llegada' : '¡Turno confirmado!'}
      tono="ok"
      extra={
        <>
          {puntos ? (
            <p className="border border-ok-borde bg-ok-fondo px-4 py-3 text-base text-ok-texto">
              Sumaste <strong>{puntos.ganados} puntos</strong> con este partido. Tenés {puntos.saldo} en total
              para canjear en el club.
            </p>
          ) : null}
          {!presente ? (
            <div className="flex flex-col items-center gap-3 bg-cal p-6 text-noche">
              {svg ? (
                <div
                  role="img"
                  aria-label="Código QR de la reserva"
                  className="size-60 [&>svg]:size-full"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generado localmente por la librería qrcode a partir de nuestra URL.
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ) : (
                <div className="size-60" />
              )}
              <p className="cifras text-base font-semibold">
                Código {codigo.slice(0, 4).toUpperCase()}-{codigo.slice(4, 8).toUpperCase()}
              </p>
            </div>
          ) : null}
        </>
      }
    >
      {presente ? null : 'Mostrá este QR al llegar. También te lo mandamos por WhatsApp.'}
    </Banda>
  );
}

/** Archivo .ics para agendar el partido (se arma en el navegador, sin pedir nada). */
function linkCalendario(r: ReservaPublica, club: ClubPublico | undefined, codigo: string) {
  const f = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escapar = (t: string) => t.replace(/[\\;,]/g, (m) => `\\${m}`);
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cancheria//Reserva//ES',
    'BEGIN:VEVENT',
    `UID:${codigo}@cancheria`,
    `DTSTAMP:${f(new Date().toISOString())}`,
    `DTSTART:${f(r.inicio)}`,
    `DTEND:${f(r.fin)}`,
    `SUMMARY:${escapar(`Fútbol en ${r.club.nombre} · ${r.cancha.nombre}`)}`,
    club?.direccion ? `LOCATION:${escapar(club.direccion)}` : '',
    `URL:${typeof window === 'undefined' ? '' : `${window.location.origin}/r/${codigo}`}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lineas.join('\r\n'))}`;
}

function Detalle({
  reserva: r,
  club,
  zona,
  codigo,
}: {
  reserva: ReservaPublica;
  club: ClubPublico | undefined;
  zona: string;
  codigo: string;
}) {
  const vigente = ['CONFIRMADO', 'PRE_RESERVADO'].includes(r.estado);
  const [enlaces, setEnlaces] = useState<{ calendario: string; compartir: string } | null>(null);
  useEffect(() => {
    const texto = `Reservé cancha en ${r.club.nombre}: ${fechaCorta(fechaLocal(r.inicio, zona))} a las ${hora(r.inicio, zona)}. ${window.location.origin}/${r.club.slug}`;
    setEnlaces({
      calendario: linkCalendario(r, club, codigo),
      compartir: `https://wa.me/?text=${encodeURIComponent(texto)}`,
    });
  }, [r, club, zona, codigo]);

  return (
    <section aria-labelledby="titulo-detalle" className="flex flex-col gap-4 border-t border-linea pt-6">
      <div>
        <h2 id="titulo-detalle" className="text-base text-tenue">
          {r.cancha.nombre}
        </h2>
        <Numero className="mt-1 block text-[34px] uppercase">
          {fechaCorta(fechaLocal(r.inicio, zona))} · {hora(r.inicio, zona)} a {hora(r.fin, zona)}
        </Numero>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-base">
        <dt className="text-tenue">A nombre de</dt>
        <dd className="text-right font-semibold">{r.cliente.nombre}</dd>
        <dt className="text-tenue">Precio del turno</dt>
        <dd className="cifras text-right font-semibold">{pesos(r.precioTotal)}</dd>
        {r.montoSena > 0 ? (
          <>
            <dt className="text-tenue">Seña</dt>
            <dd className="cifras text-right font-semibold">{pesos(r.montoSena)}</dd>
          </>
        ) : null}
        <div className="col-span-2 border-t border-linea" />
        <dt className="font-semibold">Pagás en el club</dt>
        <dd className="cifras text-right font-bold">{pesos(r.saldoAPagar)}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        {vigente && enlaces ? (
          <>
            <a
              href={enlaces.calendario}
              download={`turno-${codigo.slice(0, 8)}.ics`}
              className="inline-flex min-h-11 items-center gap-2 rounded-xs border border-borde-control px-4 text-sm font-semibold hover:border-tinta"
            >
              <IconoCalendario tamano={18} /> Agregar al calendario
            </a>
            <a
              href={enlaces.compartir}
              className="inline-flex min-h-11 items-center gap-2 rounded-xs border border-borde-control px-4 text-sm font-semibold hover:border-tinta"
            >
              <IconoWhatsApp tamano={18} /> Pasarle el dato al grupo
            </a>
          </>
        ) : null}
        {club?.direccion ? (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(club.direccion)}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-xs border border-borde-control px-4 text-sm font-semibold hover:border-tinta"
          >
            <IconoMapa tamano={18} /> Cómo llegar
          </a>
        ) : null}
      </div>
    </section>
  );
}
