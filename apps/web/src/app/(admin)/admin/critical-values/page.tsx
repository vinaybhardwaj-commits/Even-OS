import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CriticalValuesClient from './critical-values-client';

export default async function CriticalValuesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <CriticalValuesClient />;
}
