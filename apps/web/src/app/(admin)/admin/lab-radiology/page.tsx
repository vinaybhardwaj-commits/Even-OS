import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import LabRadiologyClient from './lab-radiology-client';

export default async function LabRadiologyPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <LabRadiologyClient user={user} />;
}
