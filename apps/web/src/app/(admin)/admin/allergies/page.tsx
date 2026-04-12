import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import AllergiesClient from './allergies-client';

export default async function AllergiesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');

  return <AllergiesClient />;
}
