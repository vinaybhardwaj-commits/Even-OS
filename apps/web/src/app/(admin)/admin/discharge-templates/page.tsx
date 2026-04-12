import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { DischargeTemplatesClient } from './discharge-templates-client';

export default async function DischargeTemplatesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');
  return <DischargeTemplatesClient />;
}
