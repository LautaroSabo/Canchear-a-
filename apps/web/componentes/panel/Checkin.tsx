'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';
import { ErrorApi, mensajeDe, panel } from '@/lib/api';
import { hora, hoyEn, pesos } from '@/lib/formato';
import { useAhora } from '@/lib/hooks';
import type { Agenda, DetalleTurno, ResumenCobro } from '@/lib/tipos';
import { IconoAlerta, IconoCheck } from '../iconos';
import { Aviso, Boton, EncabezadoPagina, EstadoVacio, Numero } from '../ui';
import { useClubActual } from './sesion';

type Resultado = ResumenCobro & { yaRegistrado: boolean; puntosGanados: number };

export function Checkin() {
  const { clubId, zona } = useClubActual();
  const [qr, setQr] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [cobrado, setCobrado] = useState(false);

  const checkin = useMutation({
    mutationFn: (p: { qr: string; forzar?: boolean }) => panel.post<Resultado>(`/clubs/${clubId}/checkin`, p),
  });
  const cobrar = useMutation({
    mutationFn: (r: Resultado) =>
      panel.post<ResumenCobro>(`/clubs/${clubId}/turnos/${r.turnoId}/pagos`, {
        monto: r.saldo,
        medio: 'EFECTIVO',
        concepto: 'SALDO',
      }),
    onSuccess: () => setCobrado(true),
  });

  const leer = (texto: string) => {
    setQr(texto);
    setCobrado(false);
    cobrar.reset();
    checkin.mutate({ qr: texto });
  };
  const siguiente = () => {
    setQr(null);
    setManual('');
    checkin.reset();
    cobrar.reset();
  };

  const error = checkin.error instanceof ErrorApi ? checkin.error : null;
  const r = checkin.data;

  return (
    <div className="flex flex-col gap-6">
      <EncabezadoPagina
        titulo="Check-in"
        bajada="Escaneá el QR del comprobante, buscá por código o marcá la llegada desde la lista."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {!qr ? <Camara alLeer={leer} /> : null}
          {!qr ? (
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (manual.trim()) leer(manual.trim());
              }}
            >
              <label className="text-sm font-semibold" htmlFor="codigo-manual">
                Código o link de la reserva
              </label>
              <div className="flex gap-2">
                <input
                  id="codigo-manual"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="Pegá el link o el código"
                  className="min-h-11 min-w-0 flex-1 rounded-xs border border-borde-control bg-superficie px-3 text-base"
                />
                <Boton type="submit" variante="secundario">
                  Buscar
                </Boton>
              </div>
            </form>
          ) : null}

          <div aria-live="polite" className="flex flex-col gap-4">
            {qr && checkin.isPending ? <p className="text-base text-tenue">Buscando la reserva…</p> : null}

            {r ? (
              <section className="flex flex-col gap-4 border border-ok-borde bg-superficie p-5">
                <p className="flex items-center gap-2.5 font-display text-[30px] leading-none font-bold text-ok-texto">
                  <IconoCheck tamano={28} />
                  {r.cliente?.nombre ?? 'Reserva'} {r.yaRegistrado ? 'ya estaba en cancha' : 'está en cancha'}
                </p>
                {r.puntosGanados > 0 ? (
                  <p className="text-base font-semibold text-acento-texto">Sumó {r.puntosGanados} puntos.</p>
                ) : null}
                <dl className="grid grid-cols-2 gap-3 text-base">
                  <div>
                    <dt className="text-sm text-tenue">Cancha</dt>
                    <dd className="font-semibold">{r.cancha}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-sm text-tenue">Horario</dt>
                    <dd className="font-semibold">
                      {hora(r.inicio, zona)} a {hora(r.fin, zona)}
                    </dd>
                  </div>
                </dl>
                <dl className="grid grid-cols-[1fr_auto] gap-y-1 border-t border-linea pt-3 text-base">
                  <dt className="text-tenue">Precio</dt>
                  <dd className="text-right">{pesos(r.precioTotal)}</dd>
                  <dt className="text-tenue">Ya pagado</dt>
                  <dd className="text-right">− {pesos(r.pagado)}</dd>
                  <dt className="self-end font-semibold">Saldo a cobrar</dt>
                  <dd className="text-right">
                    <Numero className="text-[36px]">{pesos(cobrado ? 0 : r.saldo)}</Numero>
                  </dd>
                </dl>
                {r.saldo > 0 && !cobrado ? (
                  <Boton grande disabled={cobrar.isPending} onClick={() => cobrar.mutate(r)}>
                    {cobrar.isPending ? 'Registrando…' : `Cobré ${pesos(r.saldo)} en efectivo`}
                  </Boton>
                ) : null}
                {cobrado ? <Aviso tipo="ok">Cobro registrado.</Aviso> : null}
                {cobrar.error ? <Aviso>{mensajeDe(cobrar.error)}</Aviso> : null}
                <Boton variante="secundario" grande onClick={siguiente}>
                  Escanear el siguiente
                </Boton>
              </section>
            ) : null}

            {error ? (
              <section className="flex flex-col gap-3 border border-error-borde bg-superficie p-5">
                <p className="flex items-center gap-2 text-lg font-semibold text-error-texto">
                  <IconoAlerta /> {error.message}
                </p>
                {error.codigo === 'FUERA_DE_HORARIO' ? (
                  <Boton onClick={() => qr && checkin.mutate({ qr, forzar: true })}>
                    Hacer el check-in igual
                  </Boton>
                ) : null}
                <Boton variante="secundario" onClick={siguiente}>
                  Escanear otro
                </Boton>
              </section>
            ) : null}
          </div>
        </div>

        <Llegadas alMarcar={leer} />
      </div>
    </div>
  );
}

/** Los que tendrían que estar llegando: confirmados que empiezan entre hace una hora y dentro de hora y media. */
function Llegadas({ alMarcar }: { alMarcar: (codigo: string) => void }) {
  const { clubId, zona } = useClubActual();
  const ahora = useAhora(60_000);
  const hoy = hoyEn(zona);
  const agenda = useQuery({
    queryKey: ['agenda', clubId, hoy],
    queryFn: () => panel.get<Agenda>(`/clubs/${clubId}/agenda?fecha=${hoy}`),
    refetchInterval: 60_000,
  });
  const [buscando, setBuscando] = useState<string | null>(null);
  const marcar = useMutation({
    mutationFn: (turnoId: string) => panel.get<DetalleTurno>(`/clubs/${clubId}/turnos/${turnoId}`),
    onMutate: (id) => setBuscando(id),
    onSuccess: (d) => alMarcar(d.codigo),
    onSettled: () => setBuscando(null),
  });
  const canchas = new Map(agenda.data?.canchas.map((c) => [c.id, c.nombre]));
  const proximos = (agenda.data?.turnos ?? [])
    .filter(
      (t) =>
        t.estado === 'CONFIRMADO' &&
        t.origen !== 'BLOQUEO' &&
        Date.parse(t.inicio) >= ahora - 60 * 60_000 &&
        Date.parse(t.inicio) <= ahora + 90 * 60_000,
    )
    .sort((a, b) => a.inicio.localeCompare(b.inicio));

  return (
    <section aria-labelledby="titulo-llegadas" className="flex flex-col gap-3">
      <h2 id="titulo-llegadas" className="font-display text-[28px] leading-none font-bold">
        Llegan ahora
      </h2>
      {proximos.length === 0 ? (
        <EstadoVacio titulo="Nadie por llegar en la próxima hora y media.">
          Los turnos confirmados aparecen acá un rato antes de empezar.
        </EstadoVacio>
      ) : (
        <ul className="flex flex-col border border-linea bg-superficie">
          {proximos.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 border-b border-linea px-4 py-3 last:border-b-0"
            >
              <span className="w-14 shrink-0 font-display text-2xl font-bold">{hora(t.inicio, zona)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold">{t.cliente?.nombre}</span>
                <span className="block text-sm text-tenue">
                  {canchas.get(t.canchaId)}
                  {t.saldo > 0 ? ` · debe ${pesos(t.saldo)}` : ' · pagado'}
                </span>
              </span>
              <Boton
                variante="secundario"
                disabled={buscando === t.id}
                onClick={() => marcar.mutate(t.id)}
                aria-label={`Marcar que llegó ${t.cliente?.nombre ?? ''}`}
              >
                Llegó
              </Boton>
            </li>
          ))}
        </ul>
      )}
      {marcar.error ? <Aviso>{mensajeDe(marcar.error)}</Aviso> : null}
    </section>
  );
}

/** Cámara trasera + jsQR (anda en todos los navegadores, también Safari de iPhone). */
function Camara({ alLeer }: { alLeer: (texto: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const callback = useRef(alLeer);
  callback.current = alLeer;
  const [problema, setProblema] = useState<string | null>(null);

  useEffect(() => {
    let flujo: MediaStream | null = null;
    let cuadro = 0;
    let vivo = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblema('Este navegador no permite usar la cámara. Ingresá el código a mano.');
        return;
      }
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch {
        setProblema(
          'No pudimos abrir la cámara. Revisá el permiso del navegador o ingresá el código a mano.',
        );
        return;
      }
      const v = video.current;
      if (!v || !vivo) return;
      v.srcObject = flujo;
      await v.play().catch(() => {});
      const analizar = () => {
        if (!vivo) return;
        const c = lienzo.current;
        if (c && v.readyState === v.HAVE_ENOUGH_DATA) {
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const img = ctx.getImageData(0, 0, c.width, c.height);
            const codigo = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (codigo?.data) {
              vivo = false;
              callback.current(codigo.data);
              return;
            }
          }
        }
        cuadro = window.setTimeout(analizar, 150);
      };
      analizar();
    })();
    return () => {
      vivo = false;
      window.clearTimeout(cuadro);
      for (const pista of flujo?.getTracks() ?? []) pista.stop();
    };
  }, []);

  if (problema) return <Aviso tipo="ambar">{problema}</Aviso>;
  return (
    <div className="relative overflow-hidden bg-noche">
      <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
      <canvas ref={lienzo} className="hidden" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto size-48 border-4 border-[#46ad65]"
      />
      <p className="absolute inset-x-0 bottom-3 text-center text-sm text-cal">
        Apuntá la cámara al QR del comprobante
      </p>
    </div>
  );
}
