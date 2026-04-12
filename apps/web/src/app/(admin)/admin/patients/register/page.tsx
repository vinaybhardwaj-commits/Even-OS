import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { RegisterPatientClient } from './register-patient-client';

export default async function RegisterPatientPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <RegisterPatientClient />;
}
