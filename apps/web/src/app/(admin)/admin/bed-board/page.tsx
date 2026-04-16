import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { BedBoardClient } from './bed-board-client';

export default async function BedBoardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <BedBoardClient userRole={user.role || ''} />;
}
