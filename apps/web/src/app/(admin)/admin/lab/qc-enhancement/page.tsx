import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import QCEnhancementAdminClient from './qc-enhancement-admin-client';

export default async function QCEnhancementPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (
    ![
      'super_admin',
      'hospital_admin',
      'admin',
      'lab_tech',
      'lab_manager',
    ].includes(user.role)
  ) {
    redirect('/');
  }

  return (
    <QCEnhancementAdminClient
      userId={user.sub}
      userRole={user.role}
      userName={user.name}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Lab', href: '/admin/lab' },
        { label: 'QC Enhancement' },
      ]}
    />
  );
}
