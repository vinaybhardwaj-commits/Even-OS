import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { InfectionSurveillanceClient } from './infection-surveillance-client';

export default async function InfectionSurveillancePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <InfectionSurveillanceClient />;
}
