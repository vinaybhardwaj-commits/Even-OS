import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { BedRackClient } from './bed-rack-client';

export default async function BedRackPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <BedRackClient userRole={user.role || ''} />;
}
