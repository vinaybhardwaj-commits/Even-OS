import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ScmPrClient from './scm-pr-client';

export default async function ScmPrPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <ScmPrClient user={user} />;
}
