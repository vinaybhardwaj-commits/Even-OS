import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import BedsideClient from './bedside-client';

export default async function BedsidePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <BedsideClient
      userId={user.sub}
      userName={user.name}
      userRole={user.role}
      hospitalId={user.hospital_id}
    />
  );
}
