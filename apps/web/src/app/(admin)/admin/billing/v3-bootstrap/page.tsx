import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import V3BootstrapClient from './v3-bootstrap-client';

export default async function BillingV3BootstrapPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Super-admin or hospital-admin only — this surface fires migration / seed
  // endpoints, so the gate is intentionally tight.
  if (!['super_admin', 'hospital_admin', 'admin'].includes(user.role)) redirect('/');

  return (
    <div>
      <V3BootstrapClient
        userId={user.sub}
        userRole={user.role}
        userName={user.name}
        hospitalId={user.hospital_id}
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Billing', href: '/admin/billing' },
          { label: 'Billing v3 Bootstrap' },
        ]}
      />
    </div>
  );
}
