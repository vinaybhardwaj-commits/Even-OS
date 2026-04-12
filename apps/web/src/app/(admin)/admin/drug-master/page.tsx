import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { DrugMasterClient } from './drug-master-client';

export default async function DrugMasterPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');

  return <DrugMasterClient />;
}
