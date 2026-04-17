import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import ApprovalsAdminClient from './approvals-admin-client';

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'admin', 'gm', 'billing_manager', 'accounts_manager', 'billing_exec'].includes(user.role)) redirect('/');

  return (
    <div>
      <ApprovalsAdminClient
        userId={user.sub}
        userRole={user.role}
        userName={user.name}
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Billing', href: '/admin/billing' },
          { label: 'Approvals' },
        ]}
      />
    </div>
  );
}
