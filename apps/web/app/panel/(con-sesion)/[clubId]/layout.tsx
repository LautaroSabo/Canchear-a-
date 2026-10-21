import { BarraLateral } from '@/componentes/panel/BarraLateral';

export default function LayoutClub({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-wrap">
      <BarraLateral />
      <main className="min-w-0 flex-[999_1_760px] px-4 py-5 sm:px-6">{children}</main>
    </div>
  );
}
