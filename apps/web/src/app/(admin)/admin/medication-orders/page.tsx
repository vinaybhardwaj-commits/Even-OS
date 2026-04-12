import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { MedicationOrdersClient } from './medication-orders-client';

export default async function MedicationOrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <MedicationOrdersClient user={user} />;
}
