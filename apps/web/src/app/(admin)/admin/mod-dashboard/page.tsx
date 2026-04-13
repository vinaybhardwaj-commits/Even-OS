import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ModDashboardClient } from './mod-dashboard-client';

export default async function ModDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <ModDashboardClient />;
}
