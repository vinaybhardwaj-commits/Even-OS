import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { OrderSetsClient } from './order-sets-client';

export default async function OrderSetsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');
  return <OrderSetsClient />;
}
