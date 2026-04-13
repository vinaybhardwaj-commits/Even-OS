import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { MrdDocumentsClient } from './mrd-documents-client';

export default async function MrdDocumentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');

  return <MrdDocumentsClient />;
}
