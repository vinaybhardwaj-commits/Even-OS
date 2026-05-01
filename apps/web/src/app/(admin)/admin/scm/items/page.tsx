import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ScmItemsClient from './scm-items-client';

export default async function ScmItemsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <ScmItemsClient user={user} />;
}
