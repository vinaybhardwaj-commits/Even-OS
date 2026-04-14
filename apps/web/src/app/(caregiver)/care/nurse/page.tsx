import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import NurseStationClient from './nurse-station-client';

export default async function NurseStationPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <NurseStationClient
      userId={user.sub}
      userName={user.name}
      userRole={user.role}
      hospitalId={user.hospital_id}
    />
  );
}
