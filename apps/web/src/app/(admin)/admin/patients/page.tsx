import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { PatientsClient } from './patients-client';

export default async function PatientsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <PatientsClient />;
}
