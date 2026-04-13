import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import BloodBankClient from './blood-bank-client';

export default async function BloodBankPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <BloodBankClient user={user} />;
}
