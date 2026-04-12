import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ProblemListClient from './problem-list-client';

export default async function ProblemListPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'doctor'].includes(user.role)) redirect('/dashboard');
  return <ProblemListClient />;
}
