import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ScmVendorsClient from './scm-vendors-client';

export default async function ScmVendorsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <ScmVendorsClient user={user} />;
}
