import { BarraLateral, NavegacionMovil } from '@/componentes/panel/BarraLateral';
import { EstadoClub } from '@/componentes/panel/EstadoClub';

export default function LayoutClub({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:flex">
      <BarraLateral />
      <NavegacionMovil />
      <main className="min-w-0 flex-1 px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-8 lg:pb-12">
        <div className="mb-5 empty:hidden">
          <EstadoClub />
        </div>
        {children}
      </main>
    </div>
  );
}
