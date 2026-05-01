import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ScmPurchaseOrdersClient from './scm-purchase-orders-client';

export default async function ScmPurchaseOrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <ScmPurchaseOrdersClient user={user} />;
}
