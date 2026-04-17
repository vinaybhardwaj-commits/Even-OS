import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import FormsAuditClient from './forms-audit-client';

export default async function FormsAuditPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['admin', 'super_admin', 'hospital_admin'].includes(user.role)) redirect('/admin');
  return (
    <FormsAuditClient
      userId={user.sub}
      userRole={user.role}
      userName={user.name}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Form Engine', href: '/admin/forms' },
        { label: 'Audit Log', href: '/admin/forms/audit' },
      ]}
    />
  );
}
