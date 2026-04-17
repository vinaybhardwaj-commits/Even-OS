import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import VendorApAdminClient from './vendor-ap-admin-client';

export default async function VendorsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'admin', 'finance_controller', 'finance_admin', 'cfo'].includes(user.role)) redirect('/');

  return (
    <VendorApAdminClient
      userId={user.sub}
      userRole={user.role}
      userName={user.name}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Finance', href: '/admin/finance' },
        { label: 'Vendors & AP' },
      ]}
    />
  );
}
