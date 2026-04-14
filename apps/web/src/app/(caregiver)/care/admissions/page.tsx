import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import AdmissionsClient from './admissions-client';

const ADMISSIONS_ROLES = [
  'receptionist', 'ip_coordinator', 'super_admin', 'hospital_admin', 'operations_manager',
];

export default async function AdmissionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!ADMISSIONS_ROLES.includes(user.role)) redirect('/care/home');
  return <AdmissionsClient userId={user.sub} userRole={user.role} userName={user.name} hospitalId={user.hospital_id} />;
}
