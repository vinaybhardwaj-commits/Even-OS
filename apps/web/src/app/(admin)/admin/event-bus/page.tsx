import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { EventBusClient } from './event-bus-client';

export default async function EventBusPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <EventBusClient />;
}
