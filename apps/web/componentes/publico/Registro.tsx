'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ErrorApi, mensajeDe, panel } from '@/lib/api';
import { Aviso, Boton, Campo } from '../ui';

/** "El Potrero F5" → "el-potrero-f5" (lo mismo que hace la API). */
function slugDesde(nombre: string) {
  return nombre
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

type Errores = Partial<Record<'nombre' | 'slug' | 'telefono' | 'dueno' | 'email' | 'contrasena', string>>;

const LARGO_CONTRASENA = 10;

export function Registro() {
  const router = useRouter();
  const qc = useQueryClient();
  const [f, setF] = useState({
    nombre: '',
    slug: '',
    telefono: '',
    direccion: '',
    dueno: '',
    email: '',
    contrasena: '',
  });
  // Mientras no toque la dirección a mano, se arma sola con el nombre del club.
  const [slugTocado, setSlugTocado] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  const formulario = useRef<HTMLFormElement>(null);
  const [origen, setOrigen] = useState('');
  useEffect(() => setOrigen(window.location.host), []);

  const slug = slugTocado ? f.slug : slugDesde(f.nombre);
  const [slugConsultado, setSlugConsultado] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSlugConsultado(slug), 350);
    return () => clearTimeout(t);
  }, [slug]);
  const disponible = useQuery({
    queryKey: ['registro-slug', slugConsultado],
    queryFn: () =>
      panel.get<{ disponible: boolean; motivo: string | null }>(
        `/registro/slug?slug=${encodeURIComponent(slugConsultado)}`,
      ),
    enabled: slugConsultado.length >= 3,
    staleTime: 30_000,
  });

  const registrar = useMutation({
    mutationFn: () =>
      panel.post<{ clubId: string }>('/registro', {
        club: {
          nombre: f.nombre.trim(),
          slug,
          telefono: f.telefono.trim(),
          ...(f.direccion.trim() ? { direccion: f.direccion.trim() } : {}),
        },
        dueno: { nombre: f.dueno.trim(), email: f.email.trim(), contrasena: f.contrasena },
      }),
    onSuccess: async ({ clubId }) => {
      await qc.invalidateQueries({ queryKey: ['sesion'] });
      router.replace(`/panel/${clubId}/configuracion`);
    },
  });

  const validar = (): Errores => {
    const e: Errores = {};
    if (f.nombre.trim().length < 2) e.nombre = 'Escribí el nombre del club.';
    if (slug.length < 3) e.slug = 'La dirección tiene que tener al menos 3 caracteres.';
    else if (disponible.data && !disponible.data.disponible)
      e.slug = disponible.data.motivo ?? 'No está disponible.';
    if (f.telefono.replace(/\D/g, '').length < 8)
      e.telefono = 'Escribí el WhatsApp del club con código de área.';
    if (f.dueno.trim().length < 2) e.dueno = 'Escribí tu nombre.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'Revisá el email.';
    if (f.contrasena.length < LARGO_CONTRASENA) e.contrasena = `Usá al menos ${LARGO_CONTRASENA} caracteres.`;
    return e;
  };

  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    const e = validar();
    setErrores(e);
    const primero = Object.keys(e)[0];
    if (primero) {
      formulario.current?.querySelector<HTMLInputElement>(`[name="${primero}"]`)?.focus();
      return;
    }
    registrar.mutate();
  };

  const errorApi = registrar.error instanceof ErrorApi ? registrar.error : null;
  const estadoSlug =
    slug.length < 3
      ? 'Es la dirección de tu página de reservas.'
      : disponible.isFetching || slugConsultado !== slug
        ? 'Revisando…'
        : disponible.data?.disponible
          ? 'Disponible.'
          : (disponible.data?.motivo ?? '');

  return (
    <form
      ref={formulario}
      onSubmit={enviar}
      noValidate
      className="flex flex-col gap-6 border border-linea bg-superficie p-6"
    >
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-display text-[28px] leading-none font-bold uppercase">Tu club</legend>
        <Campo
          etiqueta="Nombre del club"
          name="nombre"
          autoComplete="organization"
          value={f.nombre}
          error={errores.nombre}
          onChange={(e) => setF({ ...f, nombre: e.target.value })}
        />
        <Campo
          etiqueta="Dirección de tu página"
          name="slug"
          value={slug}
          error={errores.slug}
          ayuda={
            <>
              <span className="text-tinta">
                {origen || 'tusitio'}/{slug || 'tu-club'}
              </span>{' '}
              · <span aria-live="polite">{estadoSlug}</span>
            </>
          }
          onChange={(e) => {
            setSlugTocado(true);
            setF({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') });
          }}
        />
        <Campo
          etiqueta="WhatsApp del club"
          name="telefono"
          type="tel"
          autoComplete="tel"
          placeholder="11 5555-1234"
          ayuda="Lo ven los jugadores para consultas."
          value={f.telefono}
          error={errores.telefono}
          onChange={(e) => setF({ ...f, telefono: e.target.value })}
        />
        <Campo
          etiqueta={
            <span>
              Dirección <span className="font-normal text-tenue">(opcional)</span>
            </span>
          }
          name="direccion"
          autoComplete="street-address"
          value={f.direccion}
          onChange={(e) => setF({ ...f, direccion: e.target.value })}
        />
      </fieldset>

      <div aria-hidden="true" className="border-t border-linea" />
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-display text-[28px] leading-none font-bold uppercase">Tu cuenta</legend>
        <Campo
          etiqueta="Tu nombre"
          name="dueno"
          autoComplete="name"
          value={f.dueno}
          error={errores.dueno}
          onChange={(e) => setF({ ...f, dueno: e.target.value })}
        />
        <Campo
          etiqueta="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={f.email}
          error={errores.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
        />
        <Campo
          etiqueta="Contraseña"
          name="contrasena"
          type="password"
          autoComplete="new-password"
          ayuda={`Al menos ${LARGO_CONTRASENA} caracteres.`}
          value={f.contrasena}
          error={errores.contrasena}
          onChange={(e) => setF({ ...f, contrasena: e.target.value })}
        />
      </fieldset>

      {registrar.error ? (
        <Aviso>
          {errorApi?.codigo === 'EMAIL_EN_USO' ? (
            <>
              {errorApi.message}{' '}
              <a href="/panel/login" className="font-semibold underline">
                Entrar al panel
              </a>
            </>
          ) : (
            mensajeDe(registrar.error)
          )}
        </Aviso>
      ) : null}
      <Boton type="submit" grande disabled={registrar.isPending}>
        {registrar.isPending ? 'Creando tu club…' : 'Registrar mi club'}
      </Boton>
    </form>
  );
}
