import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import InsuranceClaimsClient from './insurance-claims-client';

export default async function InsuranceClaimsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <InsuranceClaimsClient user={user} />;
}
