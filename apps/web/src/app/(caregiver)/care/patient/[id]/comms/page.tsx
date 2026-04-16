import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import CommsClient from './comms-client';

export default async function CommsPage({ params, searchParams }: {
  params: { id: string };
  searchParams: { encounter?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <CommsClient
      patientId={params.id}
      encounterId={searchParams.encounter || ''}
      userId={user.sub}
      userName={user.name}
      userRole={user.role}
      hospitalId={user.hospital_id}
    />
  );
}
