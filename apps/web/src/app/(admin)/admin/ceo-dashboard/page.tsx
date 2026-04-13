import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { CeoDashboardClient } from './ceo-dashboard-client';

export default async function CeoDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <CeoDashboardClient />;
}
