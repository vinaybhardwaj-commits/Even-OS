import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import DoctorHomeClient from './doctor-home-client';

const DOCTOR_ROLES = [
  'resident', 'senior_resident', 'intern', 'visiting_consultant',
  'hospitalist', 'specialist_cardiologist', 'specialist_neurologist',
  'specialist_orthopedic', 'admin', 'super_admin',
];

export default async function DoctorHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!DOCTOR_ROLES.includes(user.role)) redirect('/care/home');
  return <DoctorHomeClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
