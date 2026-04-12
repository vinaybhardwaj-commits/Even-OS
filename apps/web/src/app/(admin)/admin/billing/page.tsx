import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import BillingClient from './billing-client';

export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <BillingClient />;
}
