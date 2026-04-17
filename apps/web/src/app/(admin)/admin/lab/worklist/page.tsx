import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import LabWorklistAdminClient from './lab-worklist-admin-client';

export default async function LabWorklistPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Restrict to lab staff and admins
  if (!['super_admin', 'hospital_admin', 'admin', 'lab_tech', 'lab_manager'].includes(user.role)) {
    redirect('/');
  }

  return (
    <LabWorklistAdminClient
      userId={user.sub}
      userRole={user.role}
      userName={user.name}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Lab', href: '/admin/lab' },
        { label: 'Worklist' },
      ]}
    />
  );
}
