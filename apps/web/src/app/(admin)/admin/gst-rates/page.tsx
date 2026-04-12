import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { GstRatesClient } from './gst-rates-client';

export default async function GstRatesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');
  return <GstRatesClient />;
}
