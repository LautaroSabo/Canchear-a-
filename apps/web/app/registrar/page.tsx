import type { Metadata } from 'next';
import Link from 'next/link';
import { PieLegal } from '@/componentes/legal/PieLegal';
import { LineasCancha } from '@/componentes/publico/LineasCancha';
import { Registro } from '@/componentes/publico/Registro';

export const metadata: Metadata = {
  title: 'Registrá tu club',
  description: 'Sumá tu club a Canchería: reservas online, señas y agenda en un solo lugar.',
};

const PASOS = [
  ['Registrás tu club', 'En un minuto, con tu email. Entrás directo a tu panel.'],
  ['Cargás canchas y precios', 'Horarios, tarifas, seña, Mercado Pago y alias para transferencias.'],
  ['Lo habilitamos', 'Revisamos el alta y tu página empieza a tomar reservas.'],
];

export default function PaginaRegistro() {
  return (
    <div className="tema-noche relative min-h-screen overflow-hidden bg-fondo text-tinta">
      <LineasCancha className="text-cal opacity-[0.05]" />
      <div className="relative mx-auto max-w-6xl px-4 pt-5 sm:px-6">
        <Link href="/" className="font-display text-2xl font-bold uppercase">
          Canchería
        </Link>
      </div>
      <main className="relative mx-auto grid max-w-6xl items-start gap-10 px-4 pt-10 pb-16 sm:px-6 md:grid-cols-[1fr_440px]">
        <div>
          <h1 className="font-display text-[48px] leading-[0.9] font-extrabold uppercase sm:text-[72px]">
            Sumá tu club
          </h1>
          <ol className="mt-8 flex flex-col gap-5">
            {PASOS.map(([titulo, texto], i) => (
              <li key={titulo} className="flex gap-4">
                <span className="font-display text-[40px] leading-none font-bold text-acento-texto">
                  {i + 1}
                </span>
                <span>
                  <span className="block text-lg font-semibold">{titulo}</span>
                  <span className="block text-base text-tenue">{texto}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-base text-tenue">
            ¿Ya tenés cuenta?{' '}
            <Link href="/panel/login" className="font-semibold text-tinta underline">
              Entrá al panel
            </Link>
          </p>
        </div>
        <Registro />
      </main>
      <div className="relative">
        <PieLegal />
      </div>
    </div>
  );
}
