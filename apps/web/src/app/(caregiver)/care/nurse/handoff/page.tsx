import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import HandoffClient from './handoff-client';

export default async function HandoffPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <HandoffClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
