import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ScmAlertsClient from './scm-alerts-client';

export default async function ScmAlertsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <ScmAlertsClient user={user} />;
}
