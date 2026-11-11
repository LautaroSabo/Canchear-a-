'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { mensajeDe, panel } from '@/lib/api';
import { Aviso, Boton, Campo, Insignia, Tarjeta } from '../ui';

interface Estado {
  activa: boolean;
  desde: string | null;
  codigosRecuperacion: number;
}

/** Verificación en dos pasos de la cuenta propia: activar (QR + código) y desactivar. */
export function DosPasos() {
  const qc = useQueryClient();
  const estado = useQuery({ queryKey: ['dos-pasos'], queryFn: () => panel.get<Estado>('/auth/dos-pasos') });
  const [paso, setPaso] = useState<'inicio' | 'qr' | 'codigos' | 'desactivar'>('inicio');
  const [secreto, setSecreto] = useState<{ secreto: string; uri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [codigos, setCodigos] = useState<string[]>([]);
  const refrescar = () => qc.invalidateQueries({ queryKey: ['dos-pasos'] });

  const preparar = useMutation({
    mutationFn: () => panel.post<{ secreto: string; uri: string }>('/auth/dos-pasos/preparar'),
    onSuccess: (r) => {
      setSecreto(r);
      setPaso('qr');
    },
  });
  const activar = useMutation({
    mutationFn: () => panel.post<{ codigosRecuperacion: string[] }>('/auth/dos-pasos/activar', { codigo }),
    onSuccess: (r) => {
      setCodigos(r.codigosRecuperacion);
      setCodigo('');
      setPaso('codigos');
      refrescar();
    },
  });
  const desactivar = useMutation({
    mutationFn: () => panel.post('/auth/dos-pasos/desactivar', { contrasena, codigo }),
    onSuccess: () => {
      setCodigo('');
      setContrasena('');
      setPaso('inicio');
      refrescar();
    },
  });

  useEffect(() => {
    if (!secreto) return;
    import('qrcode')
      .then(({ default: QR }) => QR.toString(secreto.uri, { type: 'svg', margin: 1 }))
      .then(setQr)
      .catch(() => setQr(null));
  }, [secreto]);

  if (!estado.data) return null;
  const activa = estado.data.activa;

  const enviar = (accion: () => void) => (e: FormEvent) => {
    e.preventDefault();
    accion();
  };

  return (
    <Tarjeta className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Verificación en dos pasos</h2>
        {activa ? <Insignia tono="ok">Activada</Insignia> : <Insignia tono="neutro">Apagada</Insignia>}
      </div>

      {paso === 'codigos' ? (
        <div className="flex flex-col gap-3">
          <Aviso tipo="ok">Listo: desde ahora, al entrar se te va a pedir el código del celular.</Aviso>
          <p className="text-sm">
            <strong>Guardá estos códigos de recuperación</strong> (anotalos o sacales una captura). Cada uno
            sirve una sola vez para entrar si perdés el celular. No se vuelven a mostrar.
          </p>
          <ul className="cifras grid grid-cols-2 gap-2 border border-linea bg-superficie-2 p-3 font-mono text-base">
            {codigos.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Boton variante="secundario" onClick={() => navigator.clipboard?.writeText(codigos.join('\n'))}>
              Copiar
            </Boton>
            <Boton onClick={() => setPaso('inicio')}>Ya los guardé</Boton>
          </div>
        </div>
      ) : paso === 'qr' && secreto ? (
        <form onSubmit={enviar(() => activar.mutate())} className="flex flex-col gap-3">
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            <li>
              Bajá una app autenticadora al celular: <strong>Google Authenticator</strong>, Microsoft
              Authenticator o Authy (son gratis).
            </li>
            <li>En la app, agregá una cuenta y escaneá este código:</li>
          </ol>
          {qr ? (
            <div
              role="img"
              aria-label="Código QR para la app autenticadora"
              className="size-48 self-center bg-white p-2 [&>svg]:size-full"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generado localmente por la librería qrcode.
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          ) : null}
          <p className="text-sm text-tenue">
            ¿No podés escanear? Cargá esta clave a mano:{' '}
            <code className="cifras font-mono text-tinta break-all">
              {secreto.secreto.match(/.{1,4}/g)?.join(' ')}
            </code>
          </p>
          <Campo
            etiqueta="3. Escribí el código de 6 números que muestra la app"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            required
          />
          {activar.error ? <Aviso>{mensajeDe(activar.error)}</Aviso> : null}
          <div className="flex flex-wrap gap-2">
            <Boton type="submit" disabled={activar.isPending || codigo.trim().length < 6}>
              Activar
            </Boton>
            <Boton variante="fantasma" onClick={() => setPaso('inicio')}>
              Cancelar
            </Boton>
          </div>
        </form>
      ) : paso === 'desactivar' ? (
        <form onSubmit={enviar(() => desactivar.mutate())} className="flex flex-col gap-3">
          <Campo
            etiqueta="Tu contraseña"
            type="password"
            autoComplete="current-password"
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            required
          />
          <Campo
            etiqueta="Código de la app (o uno de recuperación)"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            required
          />
          {desactivar.error ? <Aviso>{mensajeDe(desactivar.error)}</Aviso> : null}
          <div className="flex flex-wrap gap-2">
            <Boton type="submit" variante="peligro" disabled={desactivar.isPending}>
              Desactivar
            </Boton>
            <Boton variante="fantasma" onClick={() => setPaso('inicio')}>
              Cancelar
            </Boton>
          </div>
        </form>
      ) : activa ? (
        <>
          <p className="text-sm text-tenue">
            Al entrar al panel se pide la contraseña y el código del celular. Te quedan{' '}
            {estado.data.codigosRecuperacion} códigos de recuperación.
          </p>
          <div>
            <Boton variante="secundario" onClick={() => setPaso('desactivar')}>
              Desactivar
            </Boton>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-tenue">
            Además de la contraseña, al entrar se pide un código que cambia cada 30 segundos en tu celular.
            Así, aunque alguien sepa tu contraseña, no puede entrar. Muy recomendable para el dueño.
          </p>
          {preparar.error ? <Aviso>{mensajeDe(preparar.error)}</Aviso> : null}
          <div>
            <Boton onClick={() => preparar.mutate()} disabled={preparar.isPending}>
              Activar
            </Boton>
          </div>
        </>
      )}
    </Tarjeta>
  );
}
