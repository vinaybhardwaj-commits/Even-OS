import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ScmRolesClient from './scm-roles-client';

// Roles surface — Path B locked: per-hospital admin self-service via this UI.
// Phase 1.5 first cut is READ-ONLY with documentation of intended permissions.
// Phase 1.6 wires the assignment flow + SoD permission middleware.
// GMs assign by mid-November per V's lock; V is sole final approver.

export default async function ScmRolesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/');
  return <ScmRolesClient user={user} />;
}
