import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { DedupClient } from './dedup-client';

export default async function DedupPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <DedupClient />;
}
