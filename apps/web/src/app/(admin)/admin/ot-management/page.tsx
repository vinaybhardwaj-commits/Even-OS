import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { OTManagementClient } from './ot-management-client';

export default async function OTManagementPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <OTManagementClient />;
}
