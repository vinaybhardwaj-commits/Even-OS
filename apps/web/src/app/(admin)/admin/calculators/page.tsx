import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { CalculatorsAdminClient } from './calculators-admin-client';

export default async function CalculatorsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'super_admin') redirect('/dashboard');

  return <CalculatorsAdminClient />;
}
