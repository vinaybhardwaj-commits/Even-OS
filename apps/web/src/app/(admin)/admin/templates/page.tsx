import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import TemplatesAdminClient from './templates-admin-client';

export default async function TemplatesAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['admin', 'super_admin', 'hospital_admin'].includes(user.role)) redirect('/admin');
  return (
    <TemplatesAdminClient
      userId={user.sub}
      userRole={user.role}
      userName={user.name}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Clinical Templates', href: '/admin/templates' },
      ]}
    />
  );
}
