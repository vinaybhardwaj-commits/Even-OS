import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import AdmissionsClient from './admissions-client';

export default async function AdmissionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <AdmissionsClient />;
}
