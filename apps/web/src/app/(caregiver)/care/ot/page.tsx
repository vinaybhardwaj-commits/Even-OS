import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import OtClient from './ot-client';

const OT_ROLES = [
  'surgeon', 'anaesthetist', 'ot_nurse', 'ot_coordinator',
  'admin', 'super_admin',
];

export default async function OtPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!OT_ROLES.includes(user.role)) redirect('/care/home');
  return <OtClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
