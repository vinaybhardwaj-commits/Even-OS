import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import ChargeTiersClient from './charge-tiers-client';

export default async function ChargeTiersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'admin'].includes(user.role)) redirect('/');
  return <ChargeTiersClient userId={user.sub} userRole={user.role} hospitalId={user.hospital_id} />;
}
