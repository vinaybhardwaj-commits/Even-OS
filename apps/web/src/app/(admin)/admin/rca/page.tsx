import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { RcaClient } from './rca-client';

export default async function RcaPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <RcaClient />;
}
