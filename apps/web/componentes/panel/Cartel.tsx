'use client';

import { useEffect, useState } from 'react';
import { Boton, EncabezadoPagina, Segmentado } from '../ui';
import { useClubActual } from './sesion';

type Tamano = 'A4' | 'A5';

/**
 * Cartel para imprimir y pegar en el club: el QR lleva a la página de reservas. También se
 * puede bajar el QR solo, en PNG, para Instagram o el estado de WhatsApp.
 */
export function Cartel() {
  const { club } = useClubActual();
  const [origen, setOrigen] = useState('');
  const [svg, setSvg] = useState<string | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [tamano, setTamano] = useState<Tamano>('A4');
  useEffect(() => setOrigen(window.location.origin), []);
  const link = club?.slug && origen ? `${origen}/${club.slug}` : '';
  const linkCorto = link.replace(/^https?:\/\//, '');

  useEffect(() => {
    if (!link) return;
    import('qrcode')
      .then(async ({ default: QR }) => {
        setSvg(await QR.toString(link, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }));
        setPng(await QR.toDataURL(link, { width: 1200, margin: 2, errorCorrectionLevel: 'M' }));
      })
      .catch(() => setSvg(null));
  }, [link]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-4 print:hidden">
        <EncabezadoPagina
          titulo="Cartel con QR"
          bajada="Imprimilo y pegalo en la entrada, el buffet o los vestuarios: escaneando el QR, la gente ve los horarios libres y reserva sin llamarte."
        />
        <div className="flex flex-wrap items-center gap-3">
          <Segmentado
            etiqueta="Tamaño de la hoja"
            valor={tamano}
            onCambio={setTamano}
            opciones={[
              { valor: 'A4', etiqueta: 'Hoja A4' },
              { valor: 'A5', etiqueta: 'Media hoja (A5)' },
            ]}
          />
          <Boton onClick={() => window.print()} disabled={!svg}>
            Imprimir
          </Boton>
          {png && club?.slug ? (
            <a
              href={png}
              download={`qr-${club.slug}.png`}
              className="inline-flex min-h-11 items-center rounded-xs border border-borde-control px-4 text-sm font-semibold hover:border-tinta"
            >
              Bajar el QR (imagen)
            </a>
          ) : null}
        </div>
        <p className="text-sm text-tenue">
          Link de reservas: <strong className="text-tinta">{linkCorto || '…'}</strong>. Si lo imprimís en
          blanco y negro también se lee bien.
        </p>
      </div>

      <style>{`@media print { @page { size: ${tamano} portrait; margin: 0; } }`}</style>
      {/* El cartel: en pantalla, una vista previa; al imprimir, la hoja entera. */}
      <div
        id="cartel-imprimible"
        className={`mx-auto flex aspect-[210/297] w-full flex-col items-center justify-between border border-linea bg-white p-[7%] text-center text-[#0d1a14] shadow-sm print:mx-0 print:aspect-auto print:h-screen print:max-w-none print:border-0 print:shadow-none ${
          tamano === 'A4' ? 'max-w-[480px]' : 'max-w-[340px]'
        }`}
      >
        <div className="flex w-full flex-col items-center gap-[0.6em] text-[clamp(10px,2.6vw,16px)] print:text-[4.2mm]">
          <p className="font-display text-[1.2em] font-bold tracking-wide text-[#1f7a4c] uppercase">
            Reservá tu cancha
          </p>
          <h2 className="font-display text-[3.4em] leading-[0.92] font-extrabold uppercase">
            {club?.nombre ?? ''}
          </h2>
        </div>
        <div className="flex w-[66%] flex-col items-center gap-[4%] print:w-[min(66%,50vh)]">
          {svg ? (
            <div
              role="img"
              aria-label={`Código QR que lleva a ${linkCorto}`}
              className="w-full [&>svg]:h-auto [&>svg]:w-full"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generado localmente por la librería qrcode a partir del link del club.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="aspect-square w-full bg-[#eef2ef]" />
          )}
        </div>
        <div className="flex w-full flex-col items-center gap-[0.5em] text-[clamp(10px,2.4vw,15px)] print:text-[4mm]">
          <p className="text-[1.5em] font-bold">Escaneá con la cámara del celular</p>
          <p className="text-[1.1em]">Elegí el horario libre y reservá en un minuto. Sin crear cuenta.</p>
          <p className="mt-[0.4em] rounded-[3px] bg-[#0d1a14] px-[0.8em] py-[0.3em] font-mono text-[1.05em] text-white">
            {linkCorto || ' '}
          </p>
          <p className="mt-[0.6em] text-[0.8em] text-[#5b6b62]">Reservas con Canchería</p>
        </div>
      </div>
    </div>
  );
}
