/**
 * /admin/status — System status page (AD.4).
 *
 * Server-side auth gate, client-side body. The body is a single
 * <SystemStatusClient /> that owns all the data fetching + polling so we
 * don't have to round-trip through server actions.
 *
 * Gated: super_admin only. The API endpoint also re-checks, so a direct
 * curl from a hospital_admin still 403s.
 */
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { AdminShell } from '@/components/admin/AdminShell';
import { SystemStatusClient } from '@/components/admin/SystemStatusClient';

export const dynamic = 'force-dynamic';

export default async function AdminStatusPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  // Hard gate: only super_admin gets this page. Other admin roles see the
  // Command Center but not the full system internals.
  if (user.role !== 'super_admin') {
    redirect('/admin');
  }

  return (
    <AdminShell user={user}>
      <SystemStatusClient />
    </AdminShell>
  );
}
