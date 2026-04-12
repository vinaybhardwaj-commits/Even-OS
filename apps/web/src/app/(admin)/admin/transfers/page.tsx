import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import TransfersClient from './transfers-client';

export default async function TransfersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <TransfersClient />;
}
