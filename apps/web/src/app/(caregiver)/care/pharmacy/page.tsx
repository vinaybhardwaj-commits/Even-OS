import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import PharmacyClient from './pharmacy-client';

const PHARMACY_ROLES = [
  'pharmacist', 'senior_pharmacist', 'chief_pharmacist', 'admin', 'super_admin',
];

export default async function PharmacyPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!PHARMACY_ROLES.includes(user.role)) redirect('/care/home');
  return <PharmacyClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
