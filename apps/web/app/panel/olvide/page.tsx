'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { MarcoAcceso } from '@/componentes/acceso/MarcoAcceso';
import { useCaptcha } from '@/componentes/Captcha';
import { Aviso, Boton, Campo } from '@/componentes/ui';
import { mensajeDe, panel } from '@/lib/api';
import { useHidratado } from '@/lib/hooks';

export default function Olvide() {
  const [email, setEmail] = useState('');
  const hidratado = useHidratado();
  const captcha = useCaptcha();
  const pedir = useMutation({
    mutationFn: () => panel.post('/auth/olvide', { email: email.trim() }, captcha.cabeceras),
    onError: () => captcha.reiniciar(),
  });

  return (
    <MarcoAcceso
      titulo="Contraseña nueva"
      bajada="Te mandamos un link a tu email para que elijas una nueva. Vence en 1 hora."
    >
      {pedir.isSuccess ? (
        <Aviso tipo="ok">
          Si <strong>{email.trim()}</strong> tiene una cuenta en Canchería, te llegó un mail con el link.
          Revisá también spam. Si no te llega en unos minutos, fijate que sea el email con el que entrás al
          panel; si sigue sin llegar, pedile el link a quien administra Canchería.
        </Aviso>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            pedir.mutate();
          }}
        >
          <Campo
            etiqueta="Email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {pedir.error ? <Aviso>{mensajeDe(pedir.error)}</Aviso> : null}
          {captcha.widget}
          <Boton type="submit" grande disabled={!hidratado || pedir.isPending || !captcha.listo}>
            {pedir.isPending ? 'Enviando…' : 'Mandarme el link'}
          </Boton>
        </form>
      )}
    </MarcoAcceso>
  );
}
