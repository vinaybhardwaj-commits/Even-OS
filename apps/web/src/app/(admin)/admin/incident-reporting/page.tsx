import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { IncidentReportingClient } from './incident-reporting-client';

export default async function IncidentReportingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <IncidentReportingClient />;
}
