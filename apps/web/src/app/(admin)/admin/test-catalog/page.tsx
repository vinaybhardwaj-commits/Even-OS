import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import TestCatalogClient from './test-catalog-client';

export default async function TestCatalogPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');

  return <TestCatalogClient user={user} />;
}
