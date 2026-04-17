import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import InsurersAdminClient from './insurers-admin-client';

export default async function InsurersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'admin'].includes(user.role)) redirect('/');

  return (
    <div>
      <InsurersAdminClient
        userId={user.sub}
        userRole={user.role}
        userName={user.name}
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Billing', href: '/admin/billing' },
          { label: 'Insurer Master' },
        ]}
      />
    </div>
  );
}
