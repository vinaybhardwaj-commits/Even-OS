import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import CodesServicesClient from './codes-services-client';

export default async function CodesServicesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin', 'admin'].includes(user.role)) redirect('/');

  return <CodesServicesClient userId={user.sub} userRole={user.role} hospitalId={user.hospital_id} />;
}
