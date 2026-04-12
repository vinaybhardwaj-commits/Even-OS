import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ConsentsClient from './consents-client';

export default async function ConsentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');

  return <ConsentsClient />;
}
