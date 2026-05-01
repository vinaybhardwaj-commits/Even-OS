import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CareIndentClient from './care-indent-client';

export default async function CareIndentPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <CareIndentClient user={user} />;
}
