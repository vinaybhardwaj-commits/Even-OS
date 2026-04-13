import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Hl7MessagesClient } from './hl7-messages-client';

export default async function Hl7MessagesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <Hl7MessagesClient />;
}
