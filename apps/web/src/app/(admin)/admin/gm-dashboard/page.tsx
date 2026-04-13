import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { GmDashboardClient } from './gm-dashboard-client';

export default async function GmDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <GmDashboardClient />;
}
