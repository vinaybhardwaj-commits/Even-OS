import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import EmarClient from './emar-client';

export default async function EmarPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <EmarClient userId={user.sub} userRole={user.role} />;
}
