import { DetalleTorneo } from '@/componentes/panel/torneos/DetalleTorneo';

export default async function Pagina({ params }: { params: Promise<{ torneoId: string }> }) {
  return <DetalleTorneo torneoId={(await params).torneoId} />;
}
