import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CodesSettingsClient from './codes-settings-client';

export default async function CodesSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/');
  return <CodesSettingsClient />;
}
