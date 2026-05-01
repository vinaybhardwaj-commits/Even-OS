import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ScmDashboardClient from './scm-dashboard-client';

// SCM Dashboard — Phase 1.5 first cut.
// Hub for SCM Core operations: items master, inventory, vendors, POs, alerts.
// Roles: super_admin, hospital_admin, dept_head (procurement, pharmacy).
// Phase 1.6 wires SoD/RBAC middleware that gates write actions per role.

export default async function ScmDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <ScmDashboardClient user={user} />;
}
