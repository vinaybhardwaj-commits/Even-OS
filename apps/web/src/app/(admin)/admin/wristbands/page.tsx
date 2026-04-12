import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { WristbandsClient } from './wristbands-client';

export default async function WristbandsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <WristbandsClient />;
}
