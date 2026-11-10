import Link from 'next/link';

/** Pie de las páginas públicas con los textos legales. */
export function PieLegal() {
  return (
    <footer className="border-t border-linea">
      <div className="mx-auto flex max-w-6xl flex-wrap gap-x-5 gap-y-2 px-4 py-5 text-sm text-tenue sm:px-6">
        <span>Reservas con Canchería</span>
        <Link href="/terminos" className="underline hover:text-tinta">
          Términos
        </Link>
        <Link href="/privacidad" className="underline hover:text-tinta">
          Privacidad
        </Link>
      </div>
    </footer>
  );
}
