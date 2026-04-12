import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { SafetyAuditsClient } from './safety-audits-client';

export default async function SafetyAuditsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <SafetyAuditsClient />;
}
