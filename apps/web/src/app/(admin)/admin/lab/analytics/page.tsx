import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import LabAnalyticsAdminClient from './lab-analytics-admin-client';

export default async function LabAnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'admin', 'lab_manager'].includes(user.role)) redirect('/');

  return (
    <LabAnalyticsAdminClient
      userId={user.sub}
      userRole={user.role}
      userName={user.name}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Lab', href: '/admin/lab' },
        { label: 'Analytics' },
      ]}
    />
  );
}
