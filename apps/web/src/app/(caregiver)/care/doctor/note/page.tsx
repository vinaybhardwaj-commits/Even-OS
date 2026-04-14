import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import SoapNoteClient from './soap-note-client';

const DOCTOR_ROLES = [
  'resident', 'senior_resident', 'intern', 'visiting_consultant',
  'hospitalist', 'specialist_cardiologist', 'specialist_neurologist',
  'specialist_orthopedic', 'admin', 'super_admin',
];

export default async function SoapNotePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!DOCTOR_ROLES.includes(user.role)) redirect('/care/home');
  return <SoapNoteClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
