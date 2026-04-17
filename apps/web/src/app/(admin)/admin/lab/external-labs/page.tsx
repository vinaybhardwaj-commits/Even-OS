import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import ExternalLabsAdminClient from './external-labs-admin-client';

export default async function ExternalLabsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'admin'].includes(user.role)) redirect('/');

  return (
    <ExternalLabsAdminClient
      userId={user.sub}
      userRole={user.role}
      userName={user.name}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Lab', href: '/admin/lab' },
        { label: 'External Labs' },
      ]}
    />
  );
}
