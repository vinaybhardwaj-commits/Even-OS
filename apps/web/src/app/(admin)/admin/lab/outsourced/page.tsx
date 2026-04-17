import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import OutsourcedWorkflowClient from './outsourced-workflow-client';

export const metadata = {
  title: 'Outsourced Lab Workflow | Even OS',
  description: 'Manage lab orders sent to external labs',
};

export default async function OutsourcedWorkflowPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'admin', 'lab_tech', 'lab_manager'].includes(user.role)) redirect('/');

  return (
    <OutsourcedWorkflowClient
      userId={user.sub}
      userRole={user.role}
      userName={user.name}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Lab', href: '/admin/lab' },
        { label: 'Outsourced Workflow' },
      ]}
    />
  );
}
