import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import DischargeClient from './discharge-client';

export default async function DischargePage({ params }: { params: { encounterId: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const allowed = [
    'super_admin', 'hospital_admin', 'admin',
    'billing_manager', 'billing_executive', 'billing_exec', 'cashier',
    'ip_coordinator', 'gm', 'cfo', 'accounts_manager',
    'nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor',
  ];
  if (!allowed.includes(user.role)) redirect('/');
  return (
    <DischargeClient
      encounterId={params.encounterId}
      userId={user.sub}
      userRole={user.role}
      hospitalId={user.hospital_id}
    />
  );
}
