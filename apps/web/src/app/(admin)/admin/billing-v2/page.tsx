import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { BillingV2Client } from './billing-v2-client';

export default async function BillingV2Page() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <BillingV2Client user={user} />;
}
