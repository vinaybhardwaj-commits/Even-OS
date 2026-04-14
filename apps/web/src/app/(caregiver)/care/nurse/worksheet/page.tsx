import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import WorksheetClient from './worksheet-client';

export default async function WorksheetPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <WorksheetClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
