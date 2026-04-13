import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { AlertQueueClient } from './alert-queue-client';

export default async function AlertQueuePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');
  return <AlertQueueClient />;
}
