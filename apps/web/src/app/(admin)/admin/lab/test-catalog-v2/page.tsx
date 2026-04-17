import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import TestCatalogV2AdminClient from './test-catalog-v2-admin-client';

export default async function TestCatalogV2Page() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'admin'].includes(user.role)) redirect('/');

  return (
    <TestCatalogV2AdminClient
      userId={user.sub}
      userRole={user.role}
      userName={user.name}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Lab', href: '/admin/lab' },
        { label: 'Test Catalog v2' },
      ]}
    />
  );
}
