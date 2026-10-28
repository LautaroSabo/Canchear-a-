import { BotonLink } from '@/componentes/ui';

export default function ClubNoEncontrado() {
  return (
    <div className="tema-noche min-h-screen bg-fondo text-tinta">
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-5 px-6 py-16">
        <h1 className="font-display text-[56px] leading-[0.95] font-extrabold uppercase">
          No encontramos ese club
        </h1>
        <p className="text-lg text-tenue">
          Puede que el link esté incompleto o que el club haya cambiado su dirección. Pedile el link de nuevo
          al club por WhatsApp.
        </p>
        <div className="flex flex-wrap gap-2">
          <BotonLink href="/" grande>
            Ir al inicio
          </BotonLink>
        </div>
      </main>
    </div>
  );
}
