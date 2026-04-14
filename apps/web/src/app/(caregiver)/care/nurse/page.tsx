import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import NurseHomeClient from './nurse-home-client';

export default async function NurseHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <NurseHomeClient
      userId={user.sub}
      userName={user.name}
      userRole={user.role}
    />
  );
}
