import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ChartRolesAdminClient } from './chart-roles-admin-client';

/**
 * PC.3.3.C — /admin/chart/roles
 *
 * Super-admin-only CRUD surface for chart_permission_matrix. The shell is
 * a server component that enforces the super_admin gate (mirrors
 * /admin/calculators). All interaction lives in the client component.
 */
export default async function ChartRolesAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'super_admin') redirect('/dashboard');
  return <ChartRolesAdminClient />;
}
