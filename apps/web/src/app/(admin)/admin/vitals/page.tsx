import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import VitalsClient from './vitals-client';

export default async function VitalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <VitalsClient />;
}
