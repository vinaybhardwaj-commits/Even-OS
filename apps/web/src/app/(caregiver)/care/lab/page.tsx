import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import LabClient from './lab-client';

const LAB_ROLES = [
  'lab_technician', 'senior_lab_technician', 'lab_manager',
  'chief_radiologist', 'senior_radiologist', 'radiologist',
  'admin', 'super_admin',
];

export default async function LabPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!LAB_ROLES.includes(user.role)) redirect('/care/home');
  return <LabClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
