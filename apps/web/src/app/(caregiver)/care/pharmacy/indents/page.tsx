import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import PharmacyIndentsClient from './pharmacy-indents-client';

export default async function PharmacyIndentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Pharmacy fulfilment surface — open to pharmacist roles + admin overrides
  const allowed = [
    'super_admin', 'hospital_admin', 'dept_head',
    'pharmacist', 'senior_pharmacist',
  ];
  if (!allowed.includes(user.role)) redirect('/');
  return <PharmacyIndentsClient user={user} />;
}
