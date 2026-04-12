import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import LsqSyncClient from './lsq-sync-client';

export default async function LsqSyncPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <LsqSyncClient />;
}
