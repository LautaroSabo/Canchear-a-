import { Suspense } from 'react';
import { Agenda } from '@/componentes/panel/Agenda';

export default function PaginaAgenda() {
  return (
    <Suspense>
      <Agenda />
    </Suspense>
  );
}
