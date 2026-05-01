import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CodesItemClient from './codes-item-client';

export default async function CodesItemPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <CodesItemClient itemId={params.id} />;
}
