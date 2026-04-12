import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import DischargeClient from './discharge-client';

export default async function DischargePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <DischargeClient />;
}
