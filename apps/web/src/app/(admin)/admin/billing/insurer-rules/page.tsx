import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import InsurerRulesAdminClient from './insurer-rules-admin-client';

export default async function InsurerRulesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'admin'].includes(user.role)) redirect('/');

  return (
    <div>
      <InsurerRulesAdminClient
        userId={user.sub}
        userRole={user.role}
        userName={user.name}
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Billing', href: '/admin/billing' },
          { label: 'Insurer Rules' },
        ]}
      />
    </div>
  );
}
