import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import LabReportsClient from './lab-reports-client';

export default async function LabReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <LabReportsClient user={user} />;
}
