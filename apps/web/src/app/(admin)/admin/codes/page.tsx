import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CodesHomeClient from './codes-home-client';

export default async function CodesHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <CodesHomeClient user={user} />;
}
