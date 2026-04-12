import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import PharmacyClient from './pharmacy-client';

export default async function PharmacyPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <PharmacyClient user={user} />;
}
