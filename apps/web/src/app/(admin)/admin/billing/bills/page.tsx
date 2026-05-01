import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import BillsClient from './bills-client';

export default async function BillsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'admin', 'billing_manager', 'billing_executive', 'billing_exec', 'cashier', 'gm', 'cfo'].includes(user.role)) redirect('/');
  return <BillsClient userId={user.sub} userRole={user.role} hospitalId={user.hospital_id} />;
}
