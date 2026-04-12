import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import LabWorklistClient from './lab-worklist-client';

export default async function LabWorklistPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <LabWorklistClient />;
}
