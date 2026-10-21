import { redirect } from 'next/navigation';

export default async function InicioClub({ params }: { params: Promise<{ clubId: string }> }) {
  redirect(`/panel/${(await params).clubId}/agenda`);
}
