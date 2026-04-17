import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import FormsAdminClient from './forms-admin-client';

export default async function FormsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['admin', 'super_admin', 'hospital_admin'].includes(user.role)) redirect('/admin');
  return (
    <FormsAdminClient
      userId={user.sub}
      userRole={user.role}
      userName={user.name}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Form Engine', href: '/admin/forms' },
      ]}
    />
  );
}
