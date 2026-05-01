import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CodesBucketClient from './codes-bucket-client';

export default async function CodesBucketPage({ params }: { params: { bucket: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'dept_head'].includes(user.role)) redirect('/');
  return <CodesBucketClient bucket={params.bucket} />;
}
