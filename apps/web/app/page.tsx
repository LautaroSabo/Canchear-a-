import Link from 'next/link';

export default function Inicio() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <h1 className="font-display text-6xl font-bold">Canchería</h1>
      <p className="text-lg text-medio">
        Reservas online para complejos deportivos. Cada club tiene su link propio para que sus jugadores
        reserven sin crear cuenta.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/panel"
          className="inline-flex min-h-11 items-center rounded-xl bg-cancha px-5 font-bold text-white"
        >
          Entrar al panel del club
        </Link>
        <Link
          href="/la-canchita"
          className="inline-flex min-h-11 items-center rounded-xl border-[1.5px] border-borde bg-white px-5 font-bold"
        >
          Ver el club demo
        </Link>
      </div>
    </main>
  );
}
