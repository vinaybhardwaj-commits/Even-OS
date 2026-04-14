import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CustomerCareClient from './customer-care-client';

const CC_ROLES = [
  'receptionist', 'ip_coordinator', 'front_desk', 'customer_care',
  'admin', 'super_admin',
];

export default async function CustomerCarePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!CC_ROLES.includes(user.role)) redirect('/care/home');
  return <CustomerCareClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
