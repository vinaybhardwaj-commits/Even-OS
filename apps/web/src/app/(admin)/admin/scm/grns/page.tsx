import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ScmGrnsClient from './scm-grns-client';

export default async function ScmGrnsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <ScmGrnsClient user={user} />;
}
