import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ImplantsAdminClient from './implants-admin-client';

export default async function ImplantsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'admin'].includes(user.role)) redirect('/');
  return (
    <ImplantsAdminClient
      userId={user.sub}
      userRole={user.role}
      userName={user.name}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Billing', href: '/admin/billing' },
        { label: 'Implants' },
      ]}
    />
  );
}
