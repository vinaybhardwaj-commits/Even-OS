import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { NabhIndicatorsClient } from './nabh-indicators-client';

export default async function NabhIndicatorsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');
  return <NabhIndicatorsClient />;
}
