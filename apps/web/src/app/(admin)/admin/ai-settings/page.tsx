import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import AISettingsClient from './ai-settings-client';

export default async function AISettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'super_admin' && user.role !== 'admin') redirect('/dashboard');
  return <AISettingsClient />;
}
