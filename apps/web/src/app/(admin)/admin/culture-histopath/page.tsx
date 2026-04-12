import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CultureHistopathClient from './culture-histopath-client';

export default async function CultureHistopathPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <CultureHistopathClient user={user} />;
}
