import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { CarePathwaysClient } from './care-pathways-client';

export default async function CarePathwaysPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <CarePathwaysClient user={user} />;
}
