import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ChargeNurseClient from './charge-nurse-client';

const CHARGE_ROLES = ['charge_nurse', 'nursing_supervisor', 'hospital_admin', 'admin', 'super_admin'];

export default async function ChargeNursePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!CHARGE_ROLES.includes(user.role)) redirect('/care/nurse');
  return <ChargeNurseClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
