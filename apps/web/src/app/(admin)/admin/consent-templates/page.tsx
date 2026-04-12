import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ConsentTemplatesClient } from './consent-templates-client';

export default async function ConsentTemplatesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');
  return <ConsentTemplatesClient />;
}
