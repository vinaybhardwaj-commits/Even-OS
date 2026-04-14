import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ChargeNurseClient from './charge-nurse-client';

export default async function ChargeNursePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <ChargeNurseClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
