import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import RevenueDashboardClient from './revenue-dashboard-client';

export default async function RevenueDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <RevenueDashboardClient user={user} />;
}
