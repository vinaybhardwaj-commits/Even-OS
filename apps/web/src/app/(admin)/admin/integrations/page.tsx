import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { IntegrationsDashboardClient } from './integrations-dashboard-client';

export default async function IntegrationsDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <IntegrationsDashboardClient />;
}
