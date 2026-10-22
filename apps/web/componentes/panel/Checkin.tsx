'use client';

import { useMutation } from '@tanstack/react-query';
import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';
import { ErrorApi, mensajeDe, panel } from '@/lib/api';
import { hora, pesos } from '@/lib/formato';
import type { ResumenCobro } from '@/lib/tipos';
import { IconoAlerta, IconoCheck } from '../iconos';
import { Aviso, Boton, Numero, Tarjeta } from '../ui';
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
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="font-display text-[30px] font-bold">Check-in</h1>
      {!qr ? <Camara alLeer={leer} /> : null}
      {!qr ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) leer(manual.trim());
          }}
        >
          <label className="sr-only" htmlFor="codigo-manual">
            Código o link de la reserva
          </label>
          <input
            id="codigo-manual"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="O pegá el código / link de la reserva"
            className="min-h-11 flex-1 rounded-xl border border-[#c9d1cb] bg-white px-3"
          />
          <Boton type="submit" variante="secundario">
            Buscar
          </Boton>
        </form>
      ) : null}

      {qr && checkin.isPending ? <Tarjeta>Buscando la reserva…</Tarjeta> : null}

      {r ? (
        <Tarjeta className="flex flex-col gap-3.5">
          <p className="flex items-center gap-2.5 text-xl font-bold text-cancha-oscuro">
            <IconoCheck tamano={28} />
            {r.cliente?.nombre ?? 'Reserva'} {r.yaRegistrado ? 'ya estaba en cancha' : 'está en cancha'}
          </p>
          {r.puntosGanados > 0 ? (
            <p className="text-sm font-semibold text-cancha">Sumó {r.puntosGanados} puntos.</p>
          ) : null}
          <div className="flex justify-between gap-3 text-[15px]">
            <div>
              <div className="text-[13px] text-suave">Cancha</div>
              <div className="font-bold">{r.cancha}</div>
            </div>
            <div className="text-right">
              <div className="text-[13px] text-suave">Horario</div>
              <div className="font-bold">
                {hora(r.inicio, zona)} a {hora(r.fin, zona)}
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-fondo px-4 py-3.5">
            <div className="flex justify-between text-sm text-medio">
              <span>Precio</span>
              <span>{pesos(r.precioTotal)}</span>
            </div>
            <div className="mt-1 flex justify-between text-sm text-medio">
              <span>Ya pagado</span>
              <span>− {pesos(r.pagado)}</span>
            </div>
            <div className="my-2.5 h-px bg-linea" />
            <div className="flex items-baseline justify-between">
              <span className="font-bold">Saldo a cobrar</span>
              <Numero className="text-[34px]">{pesos(cobrado ? 0 : r.saldo)}</Numero>
            </div>
          </div>
          {r.saldo > 0 && !cobrado ? (
            <Boton grande disabled={cobrar.isPending} onClick={() => cobrar.mutate(r)}>
              {cobrar.isPending ? 'Registrando…' : `Cobré ${pesos(r.saldo)} en efectivo`}
            </Boton>
          ) : null}
          {cobrado ? <Aviso tipo="ok">Cobro registrado.</Aviso> : null}
          {cobrar.error ? <Aviso>{mensajeDe(cobrar.error)}</Aviso> : null}
          <Boton variante="fantasma" grande onClick={siguiente}>
            Escanear el siguiente
          </Boton>
        </Tarjeta>
      ) : null}

      {error ? (
        <Tarjeta className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-lg font-bold text-[#7a1a0c]">
            <IconoAlerta /> {error.message}
          </p>
          {error.codigo === 'FUERA_DE_HORARIO' ? (
            <Boton onClick={() => qr && checkin.mutate({ qr, forzar: true })}>Hacer el check-in igual</Boton>
          ) : null}
          <Boton variante="secundario" onClick={siguiente}>
            Escanear otro
          </Boton>
        </Tarjeta>
      ) : null}
    </div>
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
    <div className="relative overflow-hidden rounded-2xl bg-[#1e2a23]">
      <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
      <canvas ref={lienzo} className="hidden" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto size-48 rounded-2xl border-4 border-[#4ade80]/80"
      />
      <p className="absolute inset-x-0 bottom-3 text-center text-[13px] text-[#c9d3cc]">
        Apuntá la cámara al QR del comprobante
      </p>
    </div>
  );
}
