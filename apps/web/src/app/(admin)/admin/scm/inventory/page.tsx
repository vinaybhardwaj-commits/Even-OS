import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ScmInventoryClient from './scm-inventory-client';

export default async function ScmInventoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <ScmInventoryClient user={user} />;
}
