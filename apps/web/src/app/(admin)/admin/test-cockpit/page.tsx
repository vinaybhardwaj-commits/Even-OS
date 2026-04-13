import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { TestCockpitClient } from './test-cockpit-client';

export default async function TestCockpitPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Only super_admin can access the test cockpit
  if (user.role !== 'super_admin') redirect('/admin/gm-dashboard');
  return <TestCockpitClient userName={user.full_name || user.username} />;
}
