import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CodesReviewClient from './codes-review-client';

export default async function CodesReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <CodesReviewClient />;
}
