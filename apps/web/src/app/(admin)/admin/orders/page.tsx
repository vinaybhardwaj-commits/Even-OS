import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import OrdersClient from './orders-client';

export default async function OrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <OrdersClient />;
}
