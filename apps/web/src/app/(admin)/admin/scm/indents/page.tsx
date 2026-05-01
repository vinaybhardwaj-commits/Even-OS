import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ScmIndentsClient from './scm-indents-client';

export default async function ScmIndentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <ScmIndentsClient user={user} />;
}
