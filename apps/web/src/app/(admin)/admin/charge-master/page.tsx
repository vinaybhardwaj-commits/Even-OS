import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ChargeMasterClient } from './charge-master-client';

export default async function ChargeMasterPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');

  return <ChargeMasterClient />;
}
