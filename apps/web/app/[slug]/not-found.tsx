import Link from 'next/link';

export default function ClubNoEncontrado() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-start justify-center gap-3 px-6">
      <h1 className="font-display text-4xl font-bold">No encontramos ese club</h1>
      <p className="text-suave">
        Revisá el link que te pasaron. Si sigue sin andar, escribile al club por WhatsApp.
      </p>
      <Link href="/" className="font-semibold text-cancha underline">
        Ir al inicio
      </Link>
    </main>
  );
}
