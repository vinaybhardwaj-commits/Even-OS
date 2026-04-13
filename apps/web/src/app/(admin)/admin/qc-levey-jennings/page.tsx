import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import QcLeveyJenningsClient from './qc-levey-jennings-client';

export default async function QcLeveyJenningsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <QcLeveyJenningsClient user={user} />;
}
