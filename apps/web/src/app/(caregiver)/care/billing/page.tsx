import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import BillingClient from './billing-client';

const BILLING_ROLES = [
  'billing_manager', 'billing_executive', 'insurance_coordinator',
  'financial_analyst', 'accounts_manager', 'admin', 'super_admin',
];

export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!BILLING_ROLES.includes(user.role)) redirect('/care/home');
  return <BillingClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
